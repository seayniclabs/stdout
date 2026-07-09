/**
 * Pure Loki LogQL response parse / classify / aggregate (no DB, no HTTP).
 * Shared by loki.ts and unit tests.
 */

export const ERROR_RE = /\b(error|err|exception|fail(?:ed|ure)?|fatal|panic|traceback|oom|out of memory)\b/i;
export const WARN_RE = /\b(warn(?:ing)?|degraded|retry|timeout|slow)\b/i;
export const CRITICAL_RE = /\b(critical|fatal|panic|oom|out of memory|segfault|emergency)\b/i;

/** Default StdOut stream labels (TOOL5 query consistency). */
export const DEFAULT_JOB = 'stdout';
export const DEFAULT_EXECUTOR_LABEL = '__tmp_durable_executor';
export const DEFAULT_EXECUTOR = 'loki';

export const DEFAULT_ERROR_LOGQL =
  `{job="${DEFAULT_JOB}"} |~ "(?i)(error|critical|fatal|panic|exception|fail)"`;

/** Max lookback window (minutes). Unbounded ranges caused prior Cursor timeouts. */
export const MAX_RANGE_MINUTES = 24 * 60;
export const DEFAULT_RANGE_MINUTES = 15;

export function emptyMetrics() {
  return {
    loki_log_total: 0,
    loki_error_count: 0,
    loki_warn_count: 0,
    loki_critical_count: 0,
    loki_stream_count: 0,
    loki_unique_labels: 0,
  };
}

/**
 * Build a LogQL selector from optional service/job/container labels.
 * Defaults to job=stdout for query consistency (TOOL5).
 * Optional executor label (__tmp_durable_executor=loki) is included only when
 * opts.executor is truthy (avoids empty results on streams that omit it).
 */
export function buildLogQL(opts = {}) {
  if (opts.query && String(opts.query).trim()) {
    return String(opts.query).trim();
  }

  const labels = [];
  if (opts.service) labels.push(`service="${escapeLabel(opts.service)}"`);
  if (opts.job) labels.push(`job="${escapeLabel(opts.job)}"`);
  if (opts.container) labels.push(`container="${escapeLabel(opts.container)}"`);
  if (opts.app) labels.push(`app="${escapeLabel(opts.app)}"`);
  if (opts.executor) {
    const exec = opts.executor === true ? DEFAULT_EXECUTOR : String(opts.executor);
    labels.push(`${DEFAULT_EXECUTOR_LABEL}="${escapeLabel(exec)}"`);
  }

  // Default selector: job=stdout (not {job=~".+"} — unbounded label match).
  const selector = labels.length > 0
    ? `{${labels.join(',')}}`
    : `{job="${DEFAULT_JOB}"}`;
  const lineFilter = opts.lineFilter != null
    ? String(opts.lineFilter)
    : '|~ "(?i)(error|critical|fatal|panic|exception|fail)"';

  return `${selector} ${lineFilter}`.trim();
}

/**
 * Clamp a lookback window to [1, MAX_RANGE_MINUTES].
 * Rejects unbounded / zero start markers from prior timeout incidents.
 */
export function clampRangeMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RANGE_MINUTES;
  return Math.max(1, Math.min(Math.floor(n), MAX_RANGE_MINUTES));
}

/**
 * True when start is an unbounded marker (0, "0", epoch-zero) that must not
 * be sent to Loki (prior lesson: Cursor timeout on start=0).
 */
export function isUnboundedStart(start) {
  if (start == null || start === '') return false;
  if (start === 0 || start === '0') return true;
  if (typeof start === 'number' && start > 0 && start < 1e9) return false;
  if (typeof start === 'number' && start === 0) return true;
  const s = String(start).trim();
  if (s === '0' || s === '0n') return true;
  // Nanosecond / ms epoch at Unix zero
  if (/^0+$/.test(s)) return true;
  return false;
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Classify a single log line severity.
 * @returns {'critical'|'error'|'warn'|'info'}
 */
export function classifyLogLine(message) {
  const msg = String(message ?? '');
  if (CRITICAL_RE.test(msg)) return 'critical';
  if (ERROR_RE.test(msg)) return 'error';
  if (WARN_RE.test(msg)) return 'warn';
  return 'info';
}

/**
 * Parse Loki query_range / query JSON into flat log entries.
 *
 * Accepts:
 *   - Full Loki API response: { status, data: { result: [...] } }
 *   - Bare result array: [ { stream, values } ]
 *   - Pre-normalized entries: [ { timestamp, message, labels } ]
 *   - Plain string lines: [ "error: boom" ]
 */
export function parseLokiResponse(input) {
  if (input == null) return [];

  let result = input;
  if (typeof input === 'object' && !Array.isArray(input)) {
    if (Array.isArray(input.logs)) return normalizeEntries(input.logs);
    if (Array.isArray(input.entries)) return normalizeEntries(input.entries);
    if (Array.isArray(input.streams)) result = input.streams;
    else if (input.data?.result) result = input.data.result;
    else if (Array.isArray(input.result)) result = input.result;
    else return [];
  }

  if (!Array.isArray(result)) return [];

  // Pre-normalized entries (have message field, no values array)
  if (result.length > 0 && result[0] && typeof result[0] === 'object'
      && ('message' in result[0] || typeof result[0] === 'string')
      && !('values' in result[0])) {
    return normalizeEntries(result);
  }

  const entries = [];
  for (const stream of result) {
    if (!stream || typeof stream !== 'object') continue;
    const labels = stream.stream && typeof stream.stream === 'object' ? stream.stream : {};
    const values = Array.isArray(stream.values) ? stream.values : [];
    for (const pair of values) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [tsNs, line] = pair;
      const ts = Number(tsNs);
      entries.push({
        timestamp: Number.isFinite(ts) ? Math.floor(ts / 1e6) : Date.now(), // ms
        message: String(line ?? ''),
        labels: { ...labels },
        severity: classifyLogLine(line),
      });
    }
  }

  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

function normalizeEntries(raw) {
  const entries = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      entries.push({
        timestamp: Date.now(),
        message: item,
        labels: {},
        severity: classifyLogLine(item),
      });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const message = String(item.message ?? item.line ?? item.log ?? '');
    if (!message) continue;
    let timestamp = Date.now();
    if (typeof item.timestamp === 'number') timestamp = item.timestamp;
    else if (typeof item.ts === 'number') timestamp = item.ts;
    else if (typeof item.timestamp === 'string') {
      const parsed = Date.parse(item.timestamp);
      if (Number.isFinite(parsed)) timestamp = parsed;
    }
    const labels = item.labels && typeof item.labels === 'object' ? { ...item.labels } : {};
    entries.push({
      timestamp,
      message,
      labels,
      severity: item.severity || classifyLogLine(message),
    });
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Aggregate log entries into Observatory baseline metrics (loki_* prefix).
 */
export function aggregateLokiMetrics(entries) {
  const metrics = emptyMetrics();
  const labelKeys = new Set();
  const streams = new Set();

  for (const e of entries) {
    metrics.loki_log_total++;
    if (e.severity === 'critical') metrics.loki_critical_count++;
    if (e.severity === 'error' || e.severity === 'critical') metrics.loki_error_count++;
    if (e.severity === 'warn') metrics.loki_warn_count++;

    const labels = e.labels || {};
    const streamKey = Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(',');
    if (streamKey) streams.add(streamKey);
    for (const k of Object.keys(labels)) labelKeys.add(k);
  }

  metrics.loki_stream_count = streams.size;
  metrics.loki_unique_labels = labelKeys.size;
  return metrics;
}

/**
 * Group error/critical lines by service/job/app label for incident summaries.
 */
export function groupErrorsByService(entries) {
  const groups = new Map();

  for (const e of entries) {
    if (e.severity !== 'error' && e.severity !== 'critical') continue;
    const labels = e.labels || {};
    const key = labels.service || labels.job || labels.app || labels.container || 'unknown';
    let g = groups.get(key);
    if (!g) {
      g = { service: key, count: 0, critical: 0, samples: [] };
      groups.set(key, g);
    }
    g.count++;
    if (e.severity === 'critical') g.critical++;
    if (g.samples.length < 5) g.samples.push(e.message.slice(0, 200));
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

/**
 * Extract ingestable payload from an API body.
 * Returns { queryOpts, entries } — entries may be pre-supplied (skip live query).
 */
export function payloadFromBody(body = {}) {
  const entries = parseLokiResponse(body);
  const queryOpts = {
    query: body.query,
    service: body.service,
    job: body.job,
    container: body.container,
    app: body.app,
    executor: body.executor ?? body.__tmp_durable_executor,
    lineFilter: body.lineFilter ?? body.line_filter,
    minutes: body.minutes ?? body.rangeMinutes ?? body.range_minutes,
    limit: body.limit,
    start: body.start,
    end: body.end,
  };
  return { queryOpts, entries };
}

export function hasLogData(entries) {
  return Array.isArray(entries) && entries.length > 0;
}
