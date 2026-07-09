/**
 * Pure Suricata EVE classify / correlate (no DB, no Windlass).
 * Shared by suricata.ts and unit tests.
 *
 * Suricata alert severity is inverted from typical ops scales:
 *   1 = high, 2 = medium, 3 = low
 */

/** Rolling correlation window (ms). Default 300s. */
export function correlateWindowMs() {
  return Math.max(30_000, (Number(process.env.SURICATA_CORRELATE_WINDOW_SEC) || 300) * 1000);
}

/** Alerts from the same src_ip within the window that trigger an IP block. */
export function correlateThreshold() {
  return Math.max(2, Number(process.env.SURICATA_CORRELATE_THRESHOLD) || 3);
}

const metrics = {
  suricata_alerts_processed: 0,
  suricata_alerts_skipped: 0,
  suricata_windlass_actions: 0,
  suricata_windlass_failures: 0,
};

export function getSuricataMetrics() {
  return { ...metrics };
}

export function resetSuricataMetrics() {
  metrics.suricata_alerts_processed = 0;
  metrics.suricata_alerts_skipped = 0;
  metrics.suricata_windlass_actions = 0;
  metrics.suricata_windlass_failures = 0;
}

export function incMetric(name, n = 1) {
  if (name in metrics) metrics[name] += n;
}

export function metricsPrometheusText() {
  const lines = [
    '# HELP suricata_alerts_processed Suricata EVE alerts ingested (non-skipped)',
    '# TYPE suricata_alerts_processed counter',
    `suricata_alerts_processed ${metrics.suricata_alerts_processed}`,
    '# HELP suricata_alerts_skipped Non-alert EVE events skipped',
    '# TYPE suricata_alerts_skipped counter',
    `suricata_alerts_skipped ${metrics.suricata_alerts_skipped}`,
    '# HELP suricata_windlass_actions Successful Windlass actions (ip_block / restart)',
    '# TYPE suricata_windlass_actions counter',
    `suricata_windlass_actions ${metrics.suricata_windlass_actions}`,
    '# HELP suricata_windlass_failures Failed Windlass action attempts',
    '# TYPE suricata_windlass_failures counter',
    `suricata_windlass_failures ${metrics.suricata_windlass_failures}`,
  ];
  return `${lines.join('\n')}\n`;
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  return /^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 45;
}

/** Map Suricata severity (1=high, 2=medium, 3=low) to StdOut severity. */
export function mapSuricataSeverity(raw) {
  if (raw === 1) return 'critical';
  if (raw === 2) return 'warning';
  return 'info';
}

/** Parse a single NDJSON line into an object, or null if invalid/empty. */
export function parseEveLine(line) {
  const t = (line || '').trim();
  if (!t) return null;
  try {
    const obj = JSON.parse(t);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Extract EVE JSON from a Redis stream entry field list.
 * Accepts: event/data/json/payload field, single-field value, or field-pairs.
 */
export function eveFromStreamFields(fields) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) return null;

  const map = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    map[String(fields[i])] = String(fields[i + 1]);
  }

  for (const key of ['event', 'data', 'json', 'payload', 'message']) {
    if (map[key]) {
      const obj = parseEveLine(map[key]);
      if (obj) return obj;
    }
  }

  if (Object.keys(map).length === 1) {
    const only = Object.values(map)[0];
    const obj = parseEveLine(only);
    if (obj) return obj;
  }

  // Suricata-style flat fields already look like EVE.
  if (map.event_type || map['alert.signature'] || map.src_ip) {
    const alert = {};
    const body = { ...map };
    for (const [k, v] of Object.entries(map)) {
      if (k.startsWith('alert.')) {
        alert[k.slice(6)] = v;
        delete body[k];
      }
    }
    if (Object.keys(alert).length) body.alert = alert;
    if (body.dest_port != null) body.dest_port = Number(body.dest_port) || body.dest_port;
    if (body.src_port != null) body.src_port = Number(body.src_port) || body.src_port;
    if (alert.severity != null) alert.severity = Number(alert.severity) || alert.severity;
    if (alert.signature_id != null) alert.signature_id = Number(alert.signature_id) || alert.signature_id;
    return body;
  }

  return null;
}

const correlationByIp = new Map();

function pruneCorrelation(now) {
  const windowMs = correlateWindowMs();
  for (const [ip, bucket] of correlationByIp) {
    if (now - bucket.lastSeen > windowMs) {
      correlationByIp.delete(ip);
    }
  }
}

/**
 * Record an alert for correlation. Returns the updated bucket snapshot.
 */
export function recordCorrelation(srcIp, signature, suricataSeverity, now = Date.now()) {
  pruneCorrelation(now);
  if (!isValidIp(srcIp)) {
    return { count: 1, correlated: false, signatures: signature ? [signature] : [] };
  }

  let bucket = correlationByIp.get(srcIp);
  if (!bucket || now - bucket.lastSeen > correlateWindowMs()) {
    bucket = {
      count: 0,
      firstSeen: now,
      lastSeen: now,
      signatures: new Set(),
      maxSuricataSeverity: suricataSeverity ?? 3,
    };
    correlationByIp.set(srcIp, bucket);
  }

  bucket.count += 1;
  bucket.lastSeen = now;
  if (signature) bucket.signatures.add(signature);
  if (suricataSeverity != null && suricataSeverity < bucket.maxSuricataSeverity) {
    bucket.maxSuricataSeverity = suricataSeverity;
  }

  return {
    count: bucket.count,
    correlated: bucket.count >= correlateThreshold(),
    signatures: [...bucket.signatures],
  };
}

/** Test helper — clear in-memory correlation state. */
export function resetCorrelationState() {
  correlationByIp.clear();
}

function extractServiceHint(body, destPort) {
  const alert = body.alert && typeof body.alert === 'object' ? body.alert : null;
  const candidates = [
    asString(body.app_proto),
    asString(alert?.category),
    asString(alert?.signature),
    destPort != null ? String(destPort) : '',
  ].filter(Boolean);

  for (const c of candidates) {
    const segment = c.split(/[\s/]+/).pop() || c;
    if (segment.length >= 2) return segment.slice(0, 64);
  }
  return null;
}

/**
 * Classify a single Suricata EVE JSON object.
 * Non-alert event_types return kind=none and are skipped on ingest.
 */
export function classifySuricataEve(body, opts = {}) {
  const eventType = asString(body.event_type) || 'alert';
  const alert = body.alert && typeof body.alert === 'object' ? body.alert : null;

  const srcIp = asString(body.src_ip) || null;
  const destIp = asString(body.dest_ip) || null;
  const destPort = asNumber(body.dest_port);
  const signature = alert ? asString(alert.signature) || null : null;
  const signatureId = alert ? asNumber(alert.signature_id) : null;
  const category = alert ? asString(alert.category) || null : null;
  const suricataSeverity = alert ? asNumber(alert.severity) : null;
  const serviceHint = extractServiceHint(body, destPort);

  if (eventType !== 'alert' || !alert) {
    return {
      kind: 'none',
      severity: 'info',
      title: `Suricata: ${eventType}`,
      detail: `Non-alert event_type=${eventType}`,
      srcIp,
      destIp,
      destPort,
      signature,
      signatureId,
      category,
      suricataSeverity,
      serviceHint,
      correlated: false,
      alertCount: 0,
      source: 'suricata',
    };
  }

  const corr = opts.correlate === false
    ? { count: 1, correlated: false, signatures: signature ? [signature] : [] }
    : recordCorrelation(srcIp, signature, suricataSeverity);

  let severity = mapSuricataSeverity(suricataSeverity);
  if (corr.correlated) severity = 'critical';

  let kind = 'none';
  if (severity === 'critical' && isValidIp(srcIp)) {
    kind = 'ip_block';
  } else if (severity === 'warning' && corr.correlated && isValidIp(srcIp)) {
    kind = 'ip_block';
  } else if (severity === 'warning' && serviceHint) {
    kind = 'service';
  } else if (severity === 'critical') {
    kind = serviceHint ? 'service' : 'none';
  }

  const sigLabel = signature || `sid:${signatureId ?? '?'}`;
  const title = corr.correlated
    ? `Suricata: ${sigLabel} (correlated ×${corr.count})`
    : `Suricata: ${sigLabel}`;

  // Detail for incidents (may include IPs). Console logs must not use this field.
  const detailParts = [
    category,
    srcIp ? `src=${srcIp}` : '',
    destIp ? `dst=${destIp}${destPort != null ? `:${destPort}` : ''}` : '',
    suricataSeverity != null ? `sev=${suricataSeverity}` : '',
    corr.correlated ? `signatures=${corr.signatures.join(' | ')}` : '',
    asString(body.timestamp),
  ].filter(Boolean);

  return {
    kind,
    severity,
    title,
    detail: detailParts.join(' — '),
    srcIp,
    destIp,
    destPort,
    signature,
    signatureId,
    category,
    suricataSeverity,
    serviceHint,
    correlated: corr.correlated,
    alertCount: corr.count,
    source: 'suricata',
  };
}

/** Safe log label — no IPs or full payloads (security review). */
export function safeActionLabel(alert, action, ok) {
  const sig = alert?.signatureId != null ? `sid=${alert.signatureId}` : 'sid=?';
  const kind = alert?.kind || 'none';
  const sev = alert?.severity || 'info';
  const corr = alert?.correlated ? 'correlated' : 'single';
  return `Windlass action executed action=${action} ok=${ok} kind=${kind} sev=${sev} ${sig} ${corr}`;
}
