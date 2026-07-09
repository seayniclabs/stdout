/**
 * Zeek protocol-log integration (TOOL3).
 *
 * Ingests Zeek TSV / JSONL logs (conn, dns, http, ssl, notice), aggregates
 * protocol metrics for Observatory baselines, correlates notices with related
 * flow records, and surfaces anomalies (>2σ) as incidents.
 *
 * Flow:
 *   Zeek / filebeat / cron → POST /app/api/zeek/ingest
 *     → parse → aggregate → correlate → update baselines → detect anomalies
 *
 * Local Observatory: pullZeekLogsFromContainer() reads /logs/*.log from the
 * idle zeek sidecar (after a batch analyze run) and feeds the same path.
 */

import { nanoid } from 'nanoid';
import { execFile } from 'node:child_process';
import { getDb, schema } from './db';
import { sql } from 'drizzle-orm';
import { notify } from './notify';
import { detectAnomalyHeuristic } from './observatory/degradation-mode';
import {
  ZEEK_LOG_TYPES as ZEEK_LOG_TYPES_RAW,
  emptyMetrics,
  parseZeekLog,
  parseZeekBundle,
  aggregateZeekMetrics,
  correlateZeekLogs,
  bundleFromBody,
  bundleHasData,
} from './zeek-core.mjs';

export const ZEEK_LOG_TYPES = ZEEK_LOG_TYPES_RAW as readonly ['conn', 'dns', 'http', 'ssl', 'notice'];
export type ZeekLogType = (typeof ZEEK_LOG_TYPES)[number];

export type ZeekRecord = Record<string, string | number | boolean | null>;

export interface ZeekLogBundle {
  conn?: string;
  dns?: string;
  http?: string;
  ssl?: string;
  notice?: string;
}

/** Protocol metrics written to observatory_baselines (zeek_* prefix). */
export interface ZeekMetrics {
  zeek_conn_total: number;
  zeek_conn_failed: number;
  zeek_conn_bytes_orig: number;
  zeek_conn_bytes_resp: number;
  zeek_dns_queries: number;
  zeek_dns_nxdomain: number;
  zeek_http_requests: number;
  zeek_http_errors: number;
  zeek_ssl_connections: number;
  zeek_ssl_validation_fail: number;
  zeek_notice_count: number;
}

export interface ZeekCorrelation {
  noticeUid: string | null;
  noticeNote: string;
  noticeMsg: string;
  noticeSeverity: string;
  srcIp: string | null;
  dstIp: string | null;
  relatedConn: number;
  relatedDns: number;
  relatedHttp: number;
  relatedSsl: number;
  riskScore: number;
  summary: string;
}

export interface ZeekAnomaly {
  metricName: string;
  currentValue: number;
  baselineMean: number;
  baselineStdDev: number;
  deviationSigma: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
}

export interface ZeekIngestResult {
  recordsParsed: Record<ZeekLogType, number>;
  metrics: ZeekMetrics;
  correlations: ZeekCorrelation[];
  anomalies: ZeekAnomaly[];
  baselinesUpdated: number;
  incidentIds: string[];
}

export {
  emptyMetrics,
  parseZeekLog,
  parseZeekBundle,
  aggregateZeekMetrics,
  correlateZeekLogs,
  bundleFromBody,
  bundleHasData,
};

/** Last ingested metrics per user — merged into Sentinel live snapshots. */
const lastMetricsByUser = new Map<string, ZeekMetrics>();

export function getLastZeekMetrics(userId: string): Partial<ZeekMetrics> {
  return lastMetricsByUser.get(userId) ?? {};
}

/**
 * Welford online update of mean / std_dev for one metric on one stack.
 */
function updateBaseline(
  stackId: string,
  metricName: string,
  value: number,
  now: number,
): boolean {
  const db = getDb();
  const existing = db.get(sql`
    SELECT id, mean, std_dev, sample_count, window_start
    FROM observatory_baselines
    WHERE stack_id = ${stackId} AND metric_name = ${metricName}
  `) as {
    id: string;
    mean: number;
    std_dev: number;
    sample_count: number;
    window_start: number;
  } | undefined;

  if (!existing) {
    const id = `blz_${nanoid(12)}_${metricName}`.slice(0, 64);
    db.run(sql`
      INSERT INTO observatory_baselines
        (id, stack_id, metric_name, mean, std_dev, sample_count, window_start, window_end, created_at, updated_at)
      VALUES
        (${id}, ${stackId}, ${metricName}, ${value}, ${0}, ${1}, ${now}, ${now}, ${now}, ${now})
    `);
    return true;
  }

  const n = existing.sample_count + 1;
  const delta = value - existing.mean;
  const mean = existing.mean + delta / n;
  const prevM2 = existing.std_dev * existing.std_dev * Math.max(existing.sample_count, 1);
  const delta2 = value - mean;
  const m2 = prevM2 + delta * delta2;
  const stdDev = n > 1 ? Math.sqrt(m2 / n) : 0;

  db.run(sql`
    UPDATE observatory_baselines
    SET mean = ${mean},
        std_dev = ${stdDev},
        sample_count = ${n},
        window_end = ${now},
        updated_at = ${now}
    WHERE stack_id = ${stackId} AND metric_name = ${metricName}
  `);
  return true;
}

function loadBaselines(stackId: string): Record<string, { mean: number; stdDev: number; sampleCount: number }> {
  const db = getDb();
  const rows = db.all(sql`
    SELECT metric_name, mean, std_dev, sample_count
    FROM observatory_baselines
    WHERE stack_id = ${stackId} AND metric_name LIKE 'zeek_%'
  `) as Array<{ metric_name: string; mean: number; std_dev: number; sample_count: number }>;

  const out: Record<string, { mean: number; stdDev: number; sampleCount: number }> = {};
  for (const r of rows) {
    out[r.metric_name] = { mean: r.mean, stdDev: r.std_dev, sampleCount: r.sample_count };
  }
  return out;
}

function severityFromSigma(sigma: number): ZeekAnomaly['severity'] {
  if (sigma >= 5) return 'critical';
  if (sigma >= 4) return 'high';
  if (sigma >= 3) return 'medium';
  return 'low';
}

/**
 * Compare current metrics against existing baselines (before this ingest updates them).
 * Requires sample_count >= 3 so day-one noise does not page.
 */
export function detectZeekAnomalies(
  metrics: ZeekMetrics,
  baselines: Record<string, { mean: number; stdDev: number; sampleCount: number }>,
): ZeekAnomaly[] {
  const anomalies: ZeekAnomaly[] = [];

  for (const [name, value] of Object.entries(metrics) as Array<[keyof ZeekMetrics, number]>) {
    const bl = baselines[name];
    if (!bl || bl.sampleCount < 3) continue;

    const result = detectAnomalyHeuristic(value, { mean: bl.mean, stdDev: bl.stdDev || 0.0001 }, name);
    if (!result.detected || !result.deviationSigma) continue;

    // Only flag upward spikes for count/error metrics (drops are usually quieter windows)
    if (value < bl.mean) continue;

    anomalies.push({
      metricName: name,
      currentValue: value,
      baselineMean: bl.mean,
      baselineStdDev: bl.stdDev,
      deviationSigma: result.deviationSigma,
      severity: severityFromSigma(result.deviationSigma),
      reasoning: result.reasoning,
    });
  }

  return anomalies;
}

function userStackIds(userId: string): string[] {
  const db = getDb();
  const stacks = db.all(sql`
    SELECT id FROM stacks WHERE user_id = ${userId} ORDER BY created_at ASC
  `) as Array<{ id: string }>;
  if (stacks.length > 0) return stacks.map((s) => s.id);
  return [`zeek_host_${userId}`];
}

function createZeekIncident(
  userId: string,
  title: string,
  description: string,
  severity: string,
  tags: string[],
): string {
  const db = getDb();
  const id = nanoid();
  const now = new Date();
  db.insert(schema.incidents).values({
    id,
    userId,
    stackId: null,
    title,
    description,
    severity: severity === 'critical' ? 'critical'
      : severity === 'high' ? 'high'
        : severity === 'low' ? 'low'
          : 'medium',
    status: 'active',
    tags: tags.join(','),
    createdAt: now,
    updatedAt: now,
  }).run();

  notify(userId, {
    event: 'incident_created',
    title: `[${severity.toUpperCase()}] ${title}`,
    body: description.slice(0, 200),
    url: `/app/incidents/${id}`,
  }).catch(() => {});

  return id;
}

/**
 * Ingest a Zeek log bundle: parse, aggregate, correlate, update baselines, open incidents.
 */
export async function ingestZeekLogs(
  userId: string,
  bundle: ZeekLogBundle,
  opts: { createIncidents?: boolean } = {},
): Promise<ZeekIngestResult> {
  const createIncidents = opts.createIncidents !== false;
  const byType = parseZeekBundle(bundle) as Record<ZeekLogType, ZeekRecord[]>;
  const metrics = aggregateZeekMetrics(byType) as ZeekMetrics;
  const correlations = correlateZeekLogs(byType) as ZeekCorrelation[];

  const recordsParsed = {} as Record<ZeekLogType, number>;
  for (const t of ZEEK_LOG_TYPES) recordsParsed[t] = byType[t].length;

  const stackIds = userStackIds(userId);
  const primaryStack = stackIds[0];
  const priorBaselines = loadBaselines(primaryStack);
  const anomalies = detectZeekAnomalies(metrics, priorBaselines);

  const now = Date.now();
  let baselinesUpdated = 0;
  for (const stackId of stackIds) {
    for (const [name, value] of Object.entries(metrics)) {
      if (updateBaseline(stackId, name, value, now)) baselinesUpdated++;
    }
  }

  lastMetricsByUser.set(userId, metrics);

  const incidentIds: string[] = [];
  if (createIncidents) {
    for (const a of anomalies) {
      if (a.severity === 'low') continue;
      const id = createZeekIncident(
        userId,
        `Zeek anomaly: ${a.metricName}`,
        [
          a.reasoning,
          `Current: ${a.currentValue}`,
          `Baseline: ${a.baselineMean.toFixed(2)} ± ${a.baselineStdDev.toFixed(2)}`,
          `Deviation: ${a.deviationSigma.toFixed(2)}σ`,
        ].join('\n'),
        a.severity,
        ['zeek', 'anomaly', a.metricName, a.severity],
      );
      incidentIds.push(id);
    }

    for (const c of correlations) {
      if (c.noticeSeverity !== 'critical' && c.noticeSeverity !== 'high') continue;
      if (c.riskScore < 55) continue;
      const id = createZeekIncident(
        userId,
        `Zeek notice: ${c.noticeNote}`,
        [
          c.summary,
          `Risk score: ${c.riskScore}`,
          c.srcIp ? `Source: ${c.srcIp}` : '',
          c.dstIp ? `Destination: ${c.dstIp}` : '',
        ].filter(Boolean).join('\n'),
        c.noticeSeverity,
        ['zeek', 'notice', 'correlation', c.noticeSeverity],
      );
      incidentIds.push(id);
    }
  }

  return {
    recordsParsed,
    metrics,
    correlations,
    anomalies,
    baselinesUpdated,
    incidentIds,
  };
}

function dockerExec(container: string, argv: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile('docker', ['exec', container, ...argv], { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve('');
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

/**
 * Read existing Zeek logs from the observatory zeek sidecar (no re-analysis).
 */
export async function pullZeekLogsFromContainer(
  container = 'zeek',
): Promise<ZeekLogBundle | null> {
  const bundle: ZeekLogBundle = {};
  let any = false;

  await Promise.all(
    ZEEK_LOG_TYPES.map(async (t) => {
      const text = await dockerExec(
        container,
        ['sh', '-c', `cat /logs/${t}.log 2>/dev/null | head -c 1048576`],
        10_000,
      );
      if (text.trim()) {
        bundle[t] = text;
        any = true;
      }
    }),
  );

  return any ? bundle : null;
}

/**
 * Run Zeek over the latest pcap, then pull protocol logs.
 */
export async function analyzeAndPullZeekLogs(
  container = 'zeek',
): Promise<ZeekLogBundle | null> {
  await dockerExec(
    container,
    ['sh', '-c', 'cd /logs && zeek -r /captures/capture.pcap 2>/dev/null || true'],
    120_000,
  );
  return pullZeekLogsFromContainer(container);
}
