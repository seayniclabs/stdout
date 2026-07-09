/**
 * Suricata integration — ingest EVE JSON alerts, correlate, route to Windlass.
 *
 * Keystone security signal for StdOut:
 *   Suricata (eve.json / Redis list|stream / webhook) → classify + correlate → incident
 *   → Windlass POST /v1/block-ip | /v1/restart-service (fallback: /anomaly.json)
 *
 * Suricata alert severity is inverted from typical ops scales:
 *   1 = high, 2 = medium, 3 = low
 *
 * Prior lesson: Redis stream uses short XREADGROUP blocks (loop), not 600–1200s.
 * Correlation window defaults to 300s (SURICATA_CORRELATE_WINDOW_SEC).
 */

import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { getDb, schema } from './db';
import { fireAlert } from './alert-router';
import { controlService, getAllServices, getConfig, logEvent } from './windlass';
import { notify } from './notify';
import {
  classifySuricataEve as classifyCore,
  getSuricataMetrics,
  incMetric,
  mapSuricataSeverity,
  metricsPrometheusText,
  parseEveLine,
  recordCorrelation,
  resetCorrelationState,
  resetSuricataMetrics,
  safeActionLabel,
} from './suricata-core.mjs';

export type SuricataSeverity = 'info' | 'warning' | 'critical';

export type SuricataActionKind = 'ip_block' | 'service' | 'none';

export interface ClassifiedSuricataAlert {
  kind: SuricataActionKind;
  severity: SuricataSeverity;
  title: string;
  detail: string;
  srcIp: string | null;
  destIp: string | null;
  destPort: number | null;
  signature: string | null;
  signatureId: number | null;
  category: string | null;
  suricataSeverity: number | null;
  serviceHint: string | null;
  correlated: boolean;
  alertCount: number;
  source: 'suricata';
}

export interface SuricataIngestResult {
  alert: ClassifiedSuricataAlert;
  incidentId: string | null;
  fix: {
    attempted: boolean;
    action: string;
    ok: boolean;
    detail: Record<string, unknown> | null;
    error?: string;
  };
  alertEventId: string | null;
  skipped?: boolean;
  skipReason?: string;
}

export {
  parseEveLine,
  mapSuricataSeverity,
  recordCorrelation,
  resetCorrelationState,
  getSuricataMetrics,
  resetSuricataMetrics,
  metricsPrometheusText,
  safeActionLabel,
};

const WINDLASS_MAX_ATTEMPTS = Math.max(1, Number(process.env.SURICATA_WINDLASS_RETRIES) || 3);
const WINDLASS_BASE_DELAY_MS = Math.max(100, Number(process.env.SURICATA_WINDLASS_BACKOFF_MS) || 500);

export function classifySuricataEve(
  body: Record<string, unknown>,
  opts: { correlate?: boolean } = {},
): ClassifiedSuricataAlert {
  return classifyCore(body, opts) as ClassifiedSuricataAlert;
}

function matchWindlassService(userId: string, hint: string | null): string | null {
  if (!hint) return null;
  const services = getAllServices(userId);
  const needle = hint.toLowerCase().replace(/[_\s.]+/g, '-');
  for (const svc of services) {
    const name = (svc.name || '').toLowerCase();
    const id = (svc.id || '').toLowerCase();
    if (name === needle || id === needle) return svc.id;
    if (name.includes(needle) || needle.includes(name) || id.includes(needle)) return svc.id;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function backoffDelay(attempt: number): number {
  const base = WINDLASS_BASE_DELAY_MS * (2 ** attempt);
  const jitter = Math.floor(Math.random() * WINDLASS_BASE_DELAY_MS);
  return base + jitter;
}

let cachedWindlassToken: string | null | undefined;

function resolveWindlassToken(): string | null {
  if (cachedWindlassToken !== undefined) return cachedWindlassToken;
  const fromEnv = (process.env.WINDLASS_TOKEN || '').trim();
  if (fromEnv) {
    cachedWindlassToken = fromEnv;
    return cachedWindlassToken;
  }
  // Optional file (vault: stdout/windlass → /etc/stdout/windlass.token).
  try {
    const path = (process.env.WINDLASS_TOKEN_PATH || '/etc/stdout/windlass.token').trim();
    const fromFile = readFileSync(path, 'utf8').trim();
    cachedWindlassToken = fromFile || null;
  } catch {
    cachedWindlassToken = null;
  }
  return cachedWindlassToken;
}

function windlassHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = resolveWindlassToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function postWindlass(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: windlassHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/** Interpret Windlass v1 (`status`/`action_taken`) or /anomaly.json (`ok`/`action`) responses. */
function interpretWindlassResponse(
  data: Record<string, unknown>,
  fallbackAction: string,
): { ok: boolean; action: string } {
  if (data.status === 'success' || data.action_taken === true) {
    return { ok: true, action: String(data.action || fallbackAction) };
  }
  if (data.status === 'error' || data.action_taken === false) {
    return { ok: false, action: String(data.action || fallbackAction) };
  }
  return {
    ok: data.ok !== false,
    action: String(data.action || fallbackAction),
  };
}

/** Prefer per-user Windlass config; fall back to WINDLASS_URL (observatory compose). */
function resolveWindlassBase(userId: string): string | null {
  const config = getConfig(userId);
  if (config?.enabled === false) return null;
  if (config?.endpointUrl) return config.endpointUrl.replace(/\/$/, '');
  const envUrl = (process.env.WINDLASS_URL || '').trim();
  return envUrl ? envUrl.replace(/\/$/, '') : null;
}

/**
 * Prefer TOOL1 direct endpoints (POST /v1/block-ip, POST /v1/restart-service),
 * then /anomaly.json, then commands.json restart for older Windlass builds.
 */
async function sendToWindlass(
  userId: string,
  alert: ClassifiedSuricataAlert,
  serviceId: string | null,
): Promise<{ ok: boolean; action: string; detail: Record<string, unknown> | null; error?: string }> {
  const base = resolveWindlassBase(userId);
  if (!base) {
    return { ok: false, action: 'none', detail: null, error: 'Windlass not configured' };
  }
  const serviceName = serviceId
    ? (getAllServices(userId).find(s => s.id === serviceId)?.name || serviceId)
    : alert.serviceHint;

  const kind = alert.kind === 'ip_block' ? 'ip_block'
    : alert.kind === 'service' ? 'service'
      : 'security';

  // Primary: direct v1 endpoints (Expected Output: status/action_taken).
  let primaryUrl: string;
  let primaryPayload: Record<string, unknown>;
  if (alert.kind === 'ip_block' && alert.srcIp) {
    primaryUrl = `${base}/v1/block-ip`;
    primaryPayload = {
      ip: alert.srcIp,
      reason: alert.signature || alert.title,
      source: 'suricata',
    };
  } else if (alert.kind === 'service' && serviceName) {
    primaryUrl = `${base}/v1/restart-service`;
    primaryPayload = {
      service: serviceName,
      reason: alert.signature || alert.title,
      source: 'suricata',
    };
  } else {
    primaryUrl = `${base}/anomaly.json`;
    primaryPayload = {
      kind,
      severity: alert.severity,
      service: serviceName,
      message: alert.title,
      alert: alert.signature,
      source: 'suricata',
      ip: alert.srcIp,
      src_ip: alert.srcIp,
    };
  }

  const anomalyPayload: Record<string, unknown> = {
    kind,
    severity: alert.severity,
    service: serviceName,
    message: alert.title,
    alert: alert.signature,
    source: 'suricata',
    ip: alert.srcIp,
    src_ip: alert.srcIp,
  };

  let lastError = 'Windlass unreachable';
  let tryAnomalyFallback = primaryUrl.endsWith('/v1/block-ip')
    || primaryUrl.endsWith('/v1/restart-service');

  for (let attempt = 0; attempt < WINDLASS_MAX_ATTEMPTS; attempt++) {
    try {
      const { ok, status, data } = await postWindlass(primaryUrl, primaryPayload);
      if (ok) {
        const interpreted = interpretWindlassResponse(data, kind);
        return {
          ok: interpreted.ok,
          action: interpreted.action,
          detail: data,
        };
      }
      // 404 on v1 → fall through to /anomaly.json once (older Windlass).
      if (status === 404 && tryAnomalyFallback) {
        tryAnomalyFallback = false;
        primaryUrl = `${base}/anomaly.json`;
        primaryPayload = anomalyPayload;
        continue;
      }
      // Retry 5xx / rate-limit; fail fast on other 4xx.
      if (status < 500 && status !== 429) {
        return {
          ok: false,
          action: 'none',
          detail: data,
          error: `Windlass HTTP ${status}`,
        };
      }
      lastError = `Windlass HTTP ${status}`;
    } catch (err: any) {
      lastError = err?.message || 'Windlass unreachable';
    }

    if (attempt < WINDLASS_MAX_ATTEMPTS - 1) {
      await sleep(backoffDelay(attempt));
    }
  }

  // Fallback for older Windlass builds without ip_block: restart matched service.
  if (serviceId && alert.kind !== 'none') {
    try {
      await controlService(userId, serviceId, 'restart');
      return {
        ok: true,
        action: 'restart',
        detail: { fallback: 'commands.json', serviceId },
      };
    } catch (fallbackErr: any) {
      return {
        ok: false,
        action: 'none',
        detail: null,
        error: fallbackErr?.message || lastError,
      };
    }
  }

  return {
    ok: false,
    action: 'none',
    detail: null,
    error: lastError,
  };
}

function safeLogEvent(
  userId: string,
  serviceId: string | null,
  eventType: string,
  detail: string,
): void {
  try {
    logEvent(userId, serviceId, eventType, detail);
  } catch (err: any) {
    console.warn('[suricata] event log skipped:', err?.message || 'unknown');
  }
}

function incidentSeverity(sev: SuricataSeverity): 'critical' | 'high' | 'medium' | 'low' {
  if (sev === 'critical') return 'critical';
  if (sev === 'warning') return 'high';
  return 'low';
}

/**
 * Ingest one Suricata EVE alert: classify, correlate, incident, alert, Windlass fix.
 */
export async function ingestSuricataEve(
  userId: string,
  body: Record<string, unknown>,
  opts: { autoFix?: boolean; correlate?: boolean } = {},
): Promise<SuricataIngestResult> {
  const alert = classifySuricataEve(body, { correlate: opts.correlate });

  // Skip non-alert events (flow, dns, http, stats, …)
  if (alert.alertCount === 0 && alert.kind === 'none' && !alert.signature) {
    incMetric('suricata_alerts_skipped');
    return {
      alert,
      incidentId: null,
      fix: { attempted: false, action: 'none', ok: true, detail: null },
      alertEventId: null,
      skipped: true,
      skipReason: 'non_alert_event',
    };
  }

  incMetric('suricata_alerts_processed');

  const autoFix = opts.autoFix !== false;
  const serviceId = matchWindlassService(userId, alert.serviceHint);

  let incidentId: string | null = null;
  const shouldIncident = alert.severity === 'critical' || alert.severity === 'warning';

  if (shouldIncident) {
    const db = getDb();
    const id = nanoid();
    const now = new Date();
    const tags = [
      'suricata',
      alert.kind,
      alert.severity,
      alert.correlated ? 'correlated' : '',
    ].filter(Boolean).join(',');
    const description = [
      alert.detail,
      alert.srcIp ? `Source IP: ${alert.srcIp}` : '',
      alert.destIp ? `Dest: ${alert.destIp}${alert.destPort != null ? `:${alert.destPort}` : ''}` : '',
      alert.signatureId != null ? `SID: ${alert.signatureId}` : '',
      `Kind: ${alert.kind}`,
    ].filter(Boolean).join('\n');

    db.insert(schema.incidents).values({
      id,
      userId,
      stackId: null,
      title: alert.title,
      description,
      severity: incidentSeverity(alert.severity),
      status: 'active',
      tags,
      createdAt: now,
      updatedAt: now,
    }).run();
    incidentId = id;

    notify(userId, {
      event: 'incident_created',
      title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      body: alert.title.slice(0, 200),
      url: `/app/incidents/${id}`,
    }).catch(() => {});

    if (alert.severity === 'critical') {
      notify(userId, {
        event: 'severity_critical',
        title: `CRITICAL: ${alert.title}`,
        body: alert.title.slice(0, 200),
        url: `/app/incidents/${id}`,
      }).catch(() => {});
    }
  }

  // Event log: signature/kind only — no IPs (security review).
  safeLogEvent(
    userId,
    serviceId,
    'config_changed',
    `Suricata ${alert.kind}/${alert.severity}: ${alert.signature || alert.title}`,
  );

  let alertEventId: string | null = null;
  try {
    const alertResult = await fireAlert({
      userId,
      serviceId,
      eventType: 'health_degraded',
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
    });
    alertEventId = alertResult.eventId;
  } catch {
    alertEventId = null;
  }

  let fix: SuricataIngestResult['fix'] = {
    attempted: false,
    action: 'none',
    ok: true,
    detail: null,
  };

  const shouldFix = autoFix
    && alert.kind !== 'none'
    && alert.severity !== 'info';

  if (shouldFix) {
    const result = await sendToWindlass(userId, alert, serviceId);
    fix = {
      attempted: true,
      action: result.action,
      ok: result.ok,
      detail: result.detail,
      error: result.error,
    };

    if (result.ok) {
      incMetric('suricata_windlass_actions');
      // Validation marker — no IP addresses in console (security review).
      console.log(`[suricata] ${safeActionLabel(alert, result.action, true)}`);
    } else {
      incMetric('suricata_windlass_failures');
      console.warn(`[suricata] ${safeActionLabel(alert, result.action || 'none', false)} err=${result.error || 'unknown'}`);
    }

    safeLogEvent(
      userId,
      serviceId,
      result.action === 'ip_block' ? 'config_changed'
        : result.action === 'restart' ? 'manual_start'
          : 'config_changed',
      result.ok
        ? `Windlass fix ${result.action} for Suricata ${alert.kind}`
        : `Windlass fix failed: ${result.error || 'unknown'}`,
    );
  }

  return { alert, incidentId, fix, alertEventId };
}

/**
 * Ingest a batch of EVE lines/objects (e.g. from file-tail or Redis).
 */
export async function ingestSuricataBatch(
  userId: string,
  events: Record<string, unknown>[],
  opts: { autoFix?: boolean } = {},
): Promise<{ processed: number; skipped: number; results: SuricataIngestResult[] }> {
  const results: SuricataIngestResult[] = [];
  let skipped = 0;
  for (const ev of events) {
    const result = await ingestSuricataEve(userId, ev, opts);
    if (result.skipped) skipped += 1;
    else results.push(result);
  }
  return { processed: results.length, skipped, results };
}
