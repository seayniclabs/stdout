/**
 * Loki integration (TOOL5).
 *
 * Pulls logs from Grafana Loki via the LogQL query API
 * (`/loki/api/v1/query_range`), aggregates volume/error metrics into
 * Observatory baselines, and opens incidents on >2σ spikes or critical
 * log bursts.
 *
 * Flow:
 *   POST /app/api/loki/ingest
 *     → resolve Loki data source
 *     → GET {loki}/loki/api/v1/query_range?query=<LogQL>
 *     → parse streams → aggregate → update baselines → detect anomalies
 *
 * Body may also supply pre-fetched `streams` / `logs` (tests, agents) to
 * skip the live query.
 */

import http from 'node:http';
import https from 'node:https';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { decrypt } from './crypto';
import { getDb, schema } from './db';
import { notify } from './notify';
import { detectAnomalyHeuristic } from './observatory/degradation-mode';
import {
  buildLogQL,
  emptyMetrics,
  parseLokiResponse,
  aggregateLokiMetrics,
  groupErrorsByService,
  payloadFromBody,
  hasLogData,
  clampRangeMinutes,
  isUnboundedStart,
  DEFAULT_ERROR_LOGQL,
  DEFAULT_JOB,
  DEFAULT_RANGE_MINUTES,
  MAX_RANGE_MINUTES,
} from './loki-core.mjs';

export interface LokiConfig {
  url: string;
  token: string;
  /** Skip TLS certificate verification. Must be explicitly opted in via the
   *  LOKI_INSECURE_TLS env var or a per-source flag — never on by default. */
  insecureTls?: boolean;
}

export interface LokiLogEntry {
  timestamp: number;
  message: string;
  labels: Record<string, string>;
  severity: 'critical' | 'error' | 'warn' | 'info';
}

export interface LokiMetrics {
  loki_log_total: number;
  loki_error_count: number;
  loki_warn_count: number;
  loki_critical_count: number;
  loki_stream_count: number;
  loki_unique_labels: number;
}

export interface LokiAnomaly {
  metricName: string;
  currentValue: number;
  baselineMean: number;
  baselineStdDev: number;
  deviationSigma: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
}

export interface LokiQueryOpts {
  query?: string;
  service?: string;
  job?: string;
  container?: string;
  app?: string;
  /** When set, adds __tmp_durable_executor label (true → "loki"). */
  executor?: boolean | string;
  lineFilter?: string;
  minutes?: number;
  limit?: number;
  start?: number | string;
  end?: number | string;
}

export interface LokiIngestResult {
  query: string;
  entriesFetched: number;
  metrics: LokiMetrics;
  errorGroups: Array<{ service: string; count: number; critical: number; samples: string[] }>;
  anomalies: LokiAnomaly[];
  baselinesUpdated: number;
  incidentIds: string[];
  sampleLines: string[];
}

export {
  buildLogQL,
  emptyMetrics,
  parseLokiResponse,
  aggregateLokiMetrics,
  groupErrorsByService,
  payloadFromBody,
  hasLogData,
  clampRangeMinutes,
  isUnboundedStart,
  DEFAULT_ERROR_LOGQL,
  DEFAULT_JOB,
  DEFAULT_RANGE_MINUTES,
  MAX_RANGE_MINUTES,
};

/** Last ingested metrics per user — merged into Sentinel live snapshots. */
const lastMetricsByUser = new Map<string, LokiMetrics>();

export function getLastLokiMetrics(userId: string): Partial<LokiMetrics> {
  return lastMetricsByUser.get(userId) ?? {};
}

/**
 * Probe Loki readiness (GET /ready). Prefer this over /healthz — Grafana Loki
 * exposes /ready; the brief's /healthz path is not standard.
 */
export async function checkLokiHealth(
  config: LokiConfig,
  timeoutMs = 5_000,
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  try {
    const url = new URL('/ready', config.url);
    const json = await requestText(url, config.token, timeoutMs, config.insecureTls ?? false);
    const body = json.body.trim();
    const ok = json.status === 200 && (body.length === 0 || /ready/i.test(body));
    return { ok, status: json.status, body: body.slice(0, 200) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) || 'Loki health check failed' };
  }
}

export function getLokiConfig(userId: string): LokiConfig | null {
  const db = getDb();
  const sources = db.select().from(schema.dataSources)
    .where(and(
      eq(schema.dataSources.userId, userId),
      eq(schema.dataSources.type, 'loki'),
      eq(schema.dataSources.enabled, true),
    ))
    .limit(1)
    .all();

  if (sources.length === 0 || !sources[0].url) {
    // Fall back to Observatory env URL when no user data source is configured.
    const envUrl = process.env.LOKI_URL;
    if (envUrl) {
      return {
        url: envUrl,
        token: process.env.LOKI_TOKEN || '',
        insecureTls: process.env.LOKI_INSECURE_TLS === 'true',
      };
    }
    return null;
  }

  return {
    url: sources[0].url,
    token: sources[0].token ? (decrypt(sources[0].token) || '') : '',
    // No insecureTls field in the current schema — defaults to false (safe).
  };
}

function requestText(
  url: URL,
  token: string,
  timeoutMs = 15_000,
  insecureTls = false,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      timeout: timeoutMs,
      // rejectUnauthorized defaults to true; only disable when the data source
      // has explicitly opted in (e.g. self-signed cert in a private lab).
      ...(url.protocol === 'https:' && insecureTls ? { rejectUnauthorized: false } : {}),
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Loki query timed out'));
    });
  });
}

function requestJSON(url: URL, token: string, timeoutMs = 15_000, insecureTls = false): Promise<unknown> {
  return requestText(url, token, timeoutMs, insecureTls).then(({ status, body }) => {
    if (status >= 400) {
      throw new Error(`Loki ${status}: ${body.slice(0, 200)}`);
    }
    return JSON.parse(body);
  });
}

function toNs(value: number | string | undefined, fallbackMs: number): string {
  if (value == null || value === '') return String(BigInt(fallbackMs) * 1_000_000n);
  if (typeof value === 'number') {
    // Heuristic: values > 1e15 are already ns; > 1e12 are µs; else ms or seconds.
    if (value > 1e15) return String(Math.floor(value));
    if (value > 1e12) return String(Math.floor(value * 1_000));
    if (value > 1e10) return String(Math.floor(value * 1_000_000));
    return String(BigInt(Math.floor(value * 1000)) * 1_000_000n); // seconds → ns
  }
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return toNs(Number(s), fallbackMs);
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return String(BigInt(parsed) * 1_000_000n);
  return String(BigInt(fallbackMs) * 1_000_000n);
}

/**
 * Query Loki's LogQL range API and return normalized log entries.
 *
 * Always time-bounded (prior lesson: unbounded start=0 timed out Cursor).
 * Uses /loki/api/v1/query_range (not instant /query) so log streams over a
 * window are returned.
 */
export async function queryLokiRange(
  config: LokiConfig,
  opts: LokiQueryOpts = {},
): Promise<{ query: string; entries: LokiLogEntry[] }> {
  const query = buildLogQL(opts);
  const minutes = clampRangeMinutes(opts.minutes ?? DEFAULT_RANGE_MINUTES);
  const limit = Math.max(1, Math.min(Number(opts.limit) || 500, 5000));
  const endMs = Date.now();
  const startMs = endMs - minutes * 60_000;

  // Drop unbounded start markers; fall back to the clamped minutes window.
  const startOpt = isUnboundedStart(opts.start) ? undefined : opts.start;

  const url = new URL('/loki/api/v1/query_range', config.url);
  url.searchParams.set('query', query);
  url.searchParams.set('start', toNs(startOpt, startMs));
  url.searchParams.set('end', toNs(opts.end, endMs));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('direction', 'backward');

  const json = await requestJSON(url, config.token, 15_000, config.insecureTls ?? false);
  const entries = parseLokiResponse(json) as LokiLogEntry[];
  return { query, entries };
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
    const id = `bll_${nanoid(12)}_${metricName}`.slice(0, 64);
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
    WHERE stack_id = ${stackId} AND metric_name LIKE 'loki_%'
  `) as Array<{ metric_name: string; mean: number; std_dev: number; sample_count: number }>;

  const out: Record<string, { mean: number; stdDev: number; sampleCount: number }> = {};
  for (const r of rows) {
    out[r.metric_name] = { mean: r.mean, stdDev: r.std_dev, sampleCount: r.sample_count };
  }
  return out;
}

function severityFromSigma(sigma: number): LokiAnomaly['severity'] {
  if (sigma >= 5) return 'critical';
  if (sigma >= 4) return 'high';
  if (sigma >= 3) return 'medium';
  return 'low';
}

/**
 * Compare current metrics against existing baselines (before this ingest updates them).
 * Requires sample_count >= 3 so day-one noise does not page.
 */
export function detectLokiAnomalies(
  metrics: LokiMetrics,
  baselines: Record<string, { mean: number; stdDev: number; sampleCount: number }>,
): LokiAnomaly[] {
  const anomalies: LokiAnomaly[] = [];

  for (const [name, value] of Object.entries(metrics) as Array<[keyof LokiMetrics, number]>) {
    const bl = baselines[name];
    if (!bl || bl.sampleCount < 3) continue;

    const result = detectAnomalyHeuristic(value, { mean: bl.mean, stdDev: bl.stdDev || 0.0001 }, name);
    if (!result.detected || !result.deviationSigma) continue;

    // Only flag upward spikes (error/volume bursts)
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
    SELECT id FROM stacks ORDER BY created_at ASC
  `) as Array<{ id: string }>;
  if (stacks.length > 0) return stacks.map((s) => s.id);
  return [`loki_host_${userId}`];
}

function createLokiIncident(
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
 * Ingest log entries: aggregate, update baselines, open incidents.
 */
export async function ingestLokiEntries(
  userId: string,
  entries: LokiLogEntry[],
  opts: { createIncidents?: boolean; query?: string } = {},
): Promise<LokiIngestResult> {
  const createIncidents = opts.createIncidents !== false;
  const metrics = aggregateLokiMetrics(entries) as LokiMetrics;
  const errorGroups = groupErrorsByService(entries);
  const query = opts.query || DEFAULT_ERROR_LOGQL;

  const stackIds = userStackIds(userId);
  const primaryStack = stackIds[0];
  const priorBaselines = loadBaselines(primaryStack);
  const anomalies = detectLokiAnomalies(metrics, priorBaselines);

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
      // Focus incidents on error/critical volume, not label cardinality noise
      if (a.metricName === 'loki_unique_labels' || a.metricName === 'loki_stream_count') continue;
      const id = createLokiIncident(
        userId,
        `Loki anomaly: ${a.metricName}`,
        [
          a.reasoning,
          `Current: ${a.currentValue}`,
          `Baseline: ${a.baselineMean.toFixed(2)} ± ${a.baselineStdDev.toFixed(2)}`,
          `Deviation: ${a.deviationSigma.toFixed(2)}σ`,
          `LogQL: ${query}`,
        ].join('\n'),
        a.severity,
        ['loki', 'anomaly', a.metricName, a.severity],
      );
      incidentIds.push(id);
    }

    // Critical log bursts (≥3 critical lines) even without baseline history
    for (const g of errorGroups) {
      if (g.critical < 3) continue;
      const id = createLokiIncident(
        userId,
        `Loki critical logs: ${g.service}`,
        [
          `${g.critical} critical / ${g.count} error lines for ${g.service}`,
          `LogQL: ${query}`,
          '',
          'Samples:',
          ...g.samples.map((s) => `  • ${s}`),
        ].join('\n'),
        'critical',
        ['loki', 'critical', g.service],
      );
      incidentIds.push(id);
    }
  }

  const sampleLines = entries
    .filter((e) => e.severity === 'critical' || e.severity === 'error')
    .slice(0, 10)
    .map((e) => e.message.slice(0, 200));

  return {
    query,
    entriesFetched: entries.length,
    metrics,
    errorGroups,
    anomalies,
    baselinesUpdated,
    incidentIds,
    sampleLines,
  };
}

/**
 * Resolve entries (live LogQL query or pre-supplied), then ingest.
 */
export async function ingestFromLoki(
  userId: string,
  opts: LokiQueryOpts & { entries?: LokiLogEntry[]; createIncidents?: boolean } = {},
): Promise<LokiIngestResult> {
  let entries = opts.entries ?? [];
  let query = buildLogQL(opts);

  if (!hasLogData(entries)) {
    const config = getLokiConfig(userId);
    if (!config) {
      throw new Error(
        'No Loki data source configured. Add a Loki source in Settings, set LOKI_URL, or supply streams/logs in the body.',
      );
    }
    const result = await queryLokiRange(config, opts);
    entries = result.entries;
    query = result.query;
  }

  return ingestLokiEntries(userId, entries, {
    createIncidents: opts.createIncidents,
    query,
  });
}

/** Recurring pull cadence (matches brief: every 5 minutes). */
const PULL_INTERVAL_MS = 5 * 60_000;
const lastPullByUser = new Map<string, number>();

/**
 * Sentinel helper: pull recent error logs and update baselines (no incidents).
 * Rate-limited to once per 5 minutes per user (recurring query schedule).
 * Defaults to job=stdout for query consistency.
 */
export async function pullAndIngestLokiBaselines(userId: string): Promise<Partial<LokiMetrics>> {
  try {
    const config = getLokiConfig(userId);
    if (!config) return getLastLokiMetrics(userId);

    const now = Date.now();
    const lastPull = lastPullByUser.get(userId) ?? 0;
    const cached = getLastLokiMetrics(userId);
    if (now - lastPull < PULL_INTERVAL_MS && Object.keys(cached).length > 0) {
      return cached;
    }

    // Labels job=stdout + __tmp_durable_executor=loki for TOOL5 query consistency.
    const { entries, query } = await queryLokiRange(config, {
      job: DEFAULT_JOB,
      executor: true,
      minutes: 5,
      limit: 200,
    });
    lastPullByUser.set(userId, now);
    if (entries.length === 0) return cached;
    await ingestLokiEntries(userId, entries, { createIncidents: false, query });
    return getLastLokiMetrics(userId);
  } catch {
    return getLastLokiMetrics(userId);
  }
}
