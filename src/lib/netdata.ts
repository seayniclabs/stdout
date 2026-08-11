/**
 * Netdata Cloud integration — ingest anomaly webhooks and route fixes to Windlass.
 *
 * Netdata Cloud webhook payloads:
 *   Alert:        { message, alert, info, chart, context, family, severity, ... }
 *   Reachability: { message, host, severity, status: { reachable, text } }
 *
 * Flow: Netdata Cloud → POST /app/api/netdata/webhook → classify → incident + Windlass /anomaly.json
 */

import { nanoid } from 'nanoid';
import { getDb, schema } from './db';
import { fireAlert } from './alert-router';
import { controlService, getAllServices, getConfig, logEvent } from './windlass';
import { notify } from './notify';

export type AnomalyKind =
  | 'memory'
  | 'disk'
  | 'service'
  | 'host_unreachable'
  | 'clear'
  | 'unknown';

export type AnomalySeverity = 'info' | 'warning' | 'critical' | 'clear';

export interface ClassifiedAnomaly {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  serviceHint: string | null;
  alertName: string | null;
  alertUrl: string | null;
  host: string | null;
  source: 'netdata_cloud';
}

export interface NetdataIngestResult {
  anomaly: ClassifiedAnomaly;
  incidentId: string | null;
  fix: {
    attempted: boolean;
    action: string;
    ok: boolean;
    detail: Record<string, unknown> | null;
    error?: string;
  };
  alertEventId: string | null;
}

const MEMORY_RE = /\b(ram|memory|mem\.|oom|swap|available|used mem|free mem)\b/i;
const DISK_RE = /\b(disk|space|inode|filesystem|df\.|mount|storage)\b/i;
const SERVICE_RE = /\b(cgroup|container|docker|systemd|httpcheck|portcheck|app\.|service)\b/i;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSeverity(raw: string): AnomalySeverity {
  const s = raw.toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'warning' || s === 'warn') return 'warning';
  if (s === 'clear' || s === 'recovered' || s === 'ok') return 'clear';
  if (s === 'info' || s === 'information') return 'info';
  return 'warning';
}

function haystack(body: Record<string, unknown>): string {
  return [
    body.message,
    body.alert,
    body.info,
    body.chart,
    body.context,
    body.family,
    body.class,
    body.host,
  ]
    .map(asString)
    .filter(Boolean)
    .join(' ');
}

function extractServiceHint(body: Record<string, unknown>): string | null {
  const candidates = [
    asString(body.family),
    asString(body.chart),
    asString(body.context),
    asString(body.alert),
  ].filter(Boolean);

  for (const c of candidates) {
    // Prefer the last path segment of chart/context names (e.g. cgroup.docker_n8n → docker_n8n)
    const segment = c.split('.').pop() || c;
    if (segment && segment.length >= 2) return segment;
  }
  return null;
}

/**
 * Classify a Netdata Cloud (or compatible) webhook body into an anomaly action plan.
 * Exported for unit-style tests via the webhook dry-run path.
 */
export function classifyNetdataAnomaly(body: Record<string, unknown>): ClassifiedAnomaly {
  const status = body.status && typeof body.status === 'object'
    ? (body.status as Record<string, unknown>)
    : null;

  // Reachability notifications
  if (status && typeof status.reachable === 'boolean') {
    const reachable = status.reachable === true;
    const host = asString(body.host) || null;
    const message = asString(body.message) || (reachable ? 'Host reachable' : 'Host unreachable');
    return {
      kind: reachable ? 'clear' : 'host_unreachable',
      severity: reachable ? 'info' : 'critical',
      title: reachable
        ? `Netdata: ${host || 'host'} reachable`
        : `Netdata: ${host || 'host'} unreachable`,
      detail: message,
      serviceHint: null,
      alertName: null,
      alertUrl: asString(body.url) || null,
      host,
      source: 'netdata_cloud',
    };
  }

  const severity = normalizeSeverity(asString(body.severity) || 'warning');
  const alertName = asString(body.alert) || null;
  const message = asString(body.message) || alertName || 'Netdata alert';
  const info = asString(body.info);
  const detailParts = [message, info, asString(body.chart), asString(body.context)].filter(Boolean);
  const detail = detailParts.join(' — ');
  const serviceHint = extractServiceHint(body);
  const text = haystack(body);

  if (severity === 'clear') {
    return {
      kind: 'clear',
      severity: 'clear',
      title: `Netdata cleared: ${alertName || message}`,
      detail,
      serviceHint,
      alertName,
      alertUrl: asString(body.alert_url) || null,
      host: asString(body.host) || null,
      source: 'netdata_cloud',
    };
  }

  let kind: AnomalyKind = 'unknown';
  if (MEMORY_RE.test(text)) kind = 'memory';
  else if (DISK_RE.test(text)) kind = 'disk';
  else if (SERVICE_RE.test(text) || serviceHint) kind = 'service';

  return {
    kind,
    severity,
    title: `Netdata: ${alertName || message}`,
    detail,
    serviceHint,
    alertName,
    alertUrl: asString(body.alert_url) || null,
    host: asString(body.host) || null,
    source: 'netdata_cloud',
  };
}

function matchWindlassService(userId: string, hint: string | null): string | null {
  if (!hint) return null;
  const services = getAllServices();
  const needle = hint.toLowerCase().replace(/[_\s.]+/g, '-');
  for (const svc of services) {
    const name = (svc.name || '').toLowerCase();
    const id = (svc.id || '').toLowerCase();
    if (name === needle || id === needle) return svc.id;
    if (name.includes(needle) || needle.includes(name) || id.includes(needle)) return svc.id;
  }
  return null;
}

async function sendAnomalyToWindlass(
  userId: string,
  anomaly: ClassifiedAnomaly,
  serviceId: string | null,
): Promise<{ ok: boolean; action: string; detail: Record<string, unknown> | null; error?: string }> {
  const config = getConfig();
  if (!config?.endpointUrl || config.enabled === false) {
    return { ok: false, action: 'none', detail: null, error: 'Windlass not configured' };
  }

  const serviceName = serviceId
    ? (getAllServices().find(s => s.id === serviceId)?.name || serviceId)
    : anomaly.serviceHint;

  const payload = {
    kind: anomaly.kind,
    severity: anomaly.severity,
    service: serviceName,
    message: anomaly.title,
    alert: anomaly.alertName,
    source: 'netdata',
  };

  const url = config.endpointUrl.replace(/\/$/, '') + '/anomaly.json';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        action: 'none',
        detail: data,
        error: `Windlass HTTP ${res.status}`,
      };
    }
    return {
      ok: data.ok !== false,
      action: String(data.action || 'none'),
      detail: data,
    };
  } catch (error: unknown) {
    // Fallback: if Windlass is an older build without /anomaly.json, restart a matched service.
    if (serviceId && anomaly.kind === 'service' && anomaly.severity !== 'clear') {
      try {
        await controlService(userId, serviceId, 'restart');
        return {
          ok: true,
          action: 'restart',
          detail: { fallback: 'commands.json', serviceId },
        };
      } catch (fallbackError: unknown) {
        return {
          ok: false,
          action: 'none',
          detail: null,
          error: fallbackErr?.message || error instanceof Error ? error.message : String(error) || 'Windlass unreachable',
        };
      }
    }
    return {
      ok: false,
      action: 'none',
      detail: null,
      error: error instanceof Error ? error.message : String(error) || 'Windlass unreachable',
    };
  }
}

function incidentSeverity(sev: AnomalySeverity): 'critical' | 'high' | 'medium' | 'low' {
  if (sev === 'critical') return 'critical';
  if (sev === 'warning') return 'high';
  if (sev === 'clear' || sev === 'info') return 'low';
  return 'medium';
}

/**
 * Ingest a Netdata Cloud anomaly: classify, optionally create an incident,
 * log a Windlass event, fire alerts, and request a Windlass fix.
 */
export async function ingestNetdataAnomaly(
  userId: string,
  body: Record<string, unknown>,
  opts: { autoFix?: boolean } = {},
): Promise<NetdataIngestResult> {
  const anomaly = classifyNetdataAnomaly(body);
  const autoFix = opts.autoFix !== false;
  const serviceId = matchWindlassService(userId, anomaly.serviceHint);

  let incidentId: string | null = null;
  const shouldIncident = anomaly.severity === 'critical' || anomaly.severity === 'warning';

  if (shouldIncident) {
    const db = getDb();
    const id = nanoid();
    const now = new Date();
    const tags = ['netdata', anomaly.kind, anomaly.severity].join(',');
    const description = [
      anomaly.detail,
      anomaly.host ? `Host: ${anomaly.host}` : '',
      anomaly.alertUrl ? `Netdata: ${anomaly.alertUrl}` : '',
      `Kind: ${anomaly.kind}`,
    ].filter(Boolean).join('\n');

    db.insert(schema.incidents).values({
      id,
      userId,
      stackId: null,
      title: anomaly.title,
      description,
      severity: incidentSeverity(anomaly.severity),
      status: 'active',
      tags,
      createdAt: now,
      updatedAt: now,
    }).run();
    incidentId = id;

    notify(userId, {
      event: 'incident_created',
      title: `[${anomaly.severity.toUpperCase()}] ${anomaly.title}`,
      body: anomaly.detail.slice(0, 200),
      url: `/app/incidents/${id}`,
    }).catch(() => {});

    if (anomaly.severity === 'critical') {
      notify(userId, {
        event: 'severity_critical',
        title: `CRITICAL: ${anomaly.title}`,
        body: anomaly.detail.slice(0, 200),
        url: `/app/incidents/${id}`,
      }).catch(() => {});
    }
  }

  logEvent(
    userId,
    serviceId,
    'config_changed',
    `Netdata ${anomaly.kind}/${anomaly.severity}: ${anomaly.title}`,
  );

  const alertSeverity =
    anomaly.severity === 'clear' ? 'info'
      : anomaly.severity === 'info' ? 'info'
        : anomaly.severity === 'critical' ? 'critical'
          : 'warning';

  let alertEventId: string | null = null;
  try {
    const alertResult = await fireAlert({
      userId,
      serviceId,
      eventType: anomaly.kind === 'host_unreachable' ? 'service_down'
        : anomaly.severity === 'clear' ? 'service_up'
          : 'health_degraded',
      severity: alertSeverity,
      title: anomaly.title,
      detail: anomaly.detail,
    });
    alertEventId = alertResult.eventId;
  } catch {
    alertEventId = null;
  }

  let fix: NetdataIngestResult['fix'] = {
    attempted: false,
    action: 'none',
    ok: true,
    detail: null,
  };

  const shouldFix = autoFix
    && anomaly.severity !== 'clear'
    && anomaly.severity !== 'info'
    && anomaly.kind !== 'clear';

  if (shouldFix) {
    const result = await sendAnomalyToWindlass(userId, anomaly, serviceId);
    fix = {
      attempted: true,
      action: result.action,
      ok: result.ok,
      detail: result.detail,
      error: result.error,
    };
    logEvent(
      userId,
      serviceId,
      result.action === 'shed' ? 'memory_shed' : result.action === 'restart' ? 'manual_start' : 'config_changed',
      result.ok
        ? `Windlass fix ${result.action} for Netdata ${anomaly.kind}`
        : `Windlass fix failed: ${result.error || 'unknown'}`,
    );
  }

  return { anomaly, incidentId, fix, alertEventId };
}
