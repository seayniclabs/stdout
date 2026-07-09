/**
 * Pure Zeek log parse / aggregate / correlate (no DB). Shared by zeek.ts and unit tests.
 */

export const ZEEK_LOG_TYPES = ['conn', 'dns', 'http', 'ssl', 'notice'];

const FAILED_CONN_HIST = /^(S0|REJ|RSTO|RSTR|RSTOS0|RSTRH|SH|SHR|OTH)$/;
const HIGH_NOTICE_NOTES = [
  'Scan::Port_Scan',
  'Scan::Address_Scan',
  'SSH::Password_Guessing',
  'SSH::Interesting_Hostname_Login',
  'SSL::Invalid_Server_Cert',
  'SSL::Certificate_Expired',
  'HTTP::SQL_Injection_Attacker',
  'HTTP::SQL_Injection_Victim',
  'DNS::External_Name',
  'Weird::Activity',
];

export function emptyMetrics() {
  return {
    zeek_conn_total: 0,
    zeek_conn_failed: 0,
    zeek_conn_bytes_orig: 0,
    zeek_conn_bytes_resp: 0,
    zeek_dns_queries: 0,
    zeek_dns_nxdomain: 0,
    zeek_http_requests: 0,
    zeek_http_errors: 0,
    zeek_ssl_connections: 0,
    zeek_ssl_validation_fail: 0,
    zeek_notice_count: 0,
  };
}

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '-' && v !== '(empty)') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v) {
  if (v == null) return '';
  const s = String(v);
  return s === '-' || s === '(empty)' ? '' : s;
}

export function parseZeekLog(raw, fallbackType) {
  const text = (raw || '').trim();
  if (!text) return [];

  if (text.startsWith('{') || text.split('\n').some((l) => l.trim().startsWith('{'))) {
    const out = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      try {
        const obj = JSON.parse(t);
        if (fallbackType && !obj._path) obj._path = fallbackType;
        out.push(obj);
      } catch {
        /* skip */
      }
    }
    return out;
  }

  let fields = [];
  const records = [];
  let path = fallbackType ?? '';

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#close')) continue;
    if (line.startsWith('#path')) {
      path = line.split(/\s+/)[1]?.trim() || path;
      continue;
    }
    if (line.startsWith('#fields')) {
      fields = line.replace(/^#fields\s*/, '').split('\t').map((f) => f.trim()).filter(Boolean);
      continue;
    }
    if (line.startsWith('#')) continue;
    if (fields.length === 0) continue;

    const cols = line.split('\t');
    const rec = { _path: path };
    for (let i = 0; i < fields.length; i++) {
      rec[fields[i]] = cols[i] ?? '';
    }
    records.push(rec);
  }

  return records;
}

export function parseZeekBundle(bundle) {
  const out = {};
  for (const t of ZEEK_LOG_TYPES) {
    out[t] = parseZeekLog(bundle[t] ?? '', t);
  }
  return out;
}

export function aggregateZeekMetrics(byType) {
  const m = emptyMetrics();

  for (const rec of byType.conn) {
    m.zeek_conn_total++;
    m.zeek_conn_bytes_orig += num(rec.orig_bytes ?? rec['orig_bytes']);
    m.zeek_conn_bytes_resp += num(rec.resp_bytes ?? rec['resp_bytes']);
    const hist = str(rec.history ?? rec.conn_state);
    const state = str(rec.conn_state);
    if (FAILED_CONN_HIST.test(state) || FAILED_CONN_HIST.test(hist)) {
      m.zeek_conn_failed++;
    }
  }

  for (const rec of byType.dns) {
    m.zeek_dns_queries++;
    const rcode = str(rec.rcode_name ?? rec.rcode).toUpperCase();
    if (rcode === 'NXDOMAIN' || rcode === '3') m.zeek_dns_nxdomain++;
  }

  for (const rec of byType.http) {
    m.zeek_http_requests++;
    const status = num(rec.status_code);
    if (status >= 400) m.zeek_http_errors++;
  }

  for (const rec of byType.ssl) {
    m.zeek_ssl_connections++;
    const vs = str(rec.validation_status).toLowerCase();
    if (vs && vs !== 'ok') m.zeek_ssl_validation_fail++;
  }

  m.zeek_notice_count = byType.notice.length;
  return m;
}

function ipFrom(rec, ...keys) {
  for (const k of keys) {
    const v = str(rec[k]);
    if (v) return v;
  }
  return null;
}

function noticeSeverity(note, msg) {
  const hay = `${note} ${msg}`;
  if (HIGH_NOTICE_NOTES.some((n) => hay.includes(n)) || /attack|exploit|malware|bruteforce/i.test(hay)) {
    return 'critical';
  }
  if (/scan|guess|invalid|expired|weird/i.test(hay)) return 'high';
  return 'medium';
}

export function correlateZeekLogs(byType) {
  const correlations = [];

  for (const notice of byType.notice) {
    const uid = str(notice.uid) || null;
    const srcIp = ipFrom(notice, 'src', 'id.orig_h');
    const dstIp = ipFrom(notice, 'dst', 'id.resp_h');
    const note = str(notice.note) || 'Notice::Unknown';
    const msg = str(notice.msg) || str(notice.sub) || note;

    const match = (rec) => {
      if (uid && str(rec.uid) === uid) return true;
      const o = ipFrom(rec, 'id.orig_h', 'src', 'query');
      const r = ipFrom(rec, 'id.resp_h', 'dst', 'id.orig_h');
      if (srcIp && (o === srcIp || r === srcIp)) return true;
      if (dstIp && (o === dstIp || r === dstIp)) return true;
      return false;
    };

    const relatedConn = byType.conn.filter(match).length;
    const relatedDns = byType.dns.filter(match).length;
    const relatedHttp = byType.http.filter(match).length;
    const relatedSsl = byType.ssl.filter(match).length;
    const relatedTotal = relatedConn + relatedDns + relatedHttp + relatedSsl;

    const sev = noticeSeverity(note, msg);
    let riskScore = sev === 'critical' ? 80 : sev === 'high' ? 60 : 40;
    riskScore = Math.min(100, riskScore + relatedTotal * 5);

    const parts = [
      note,
      msg !== note ? msg : '',
      srcIp ? `src=${srcIp}` : '',
      dstIp ? `dst=${dstIp}` : '',
      relatedTotal > 0
        ? `related: conn=${relatedConn} dns=${relatedDns} http=${relatedHttp} ssl=${relatedSsl}`
        : 'no related flows in batch',
    ].filter(Boolean);

    correlations.push({
      noticeUid: uid,
      noticeNote: note,
      noticeMsg: msg,
      noticeSeverity: sev,
      srcIp,
      dstIp,
      relatedConn,
      relatedDns,
      relatedHttp,
      relatedSsl,
      riskScore,
      summary: parts.join(' | '),
    });
  }

  correlations.sort((a, b) => b.riskScore - a.riskScore);
  return correlations;
}

export function bundleFromBody(body) {
  const bundle = {};
  const logs = (body.logs && typeof body.logs === 'object' && !Array.isArray(body.logs))
    ? body.logs
    : body;

  for (const t of ZEEK_LOG_TYPES) {
    const v = logs[t];
    if (typeof v === 'string' && v.trim()) {
      bundle[t] = v;
    }
  }

  const type = typeof body.type === 'string' ? body.type.toLowerCase() : '';
  if (ZEEK_LOG_TYPES.includes(type)) {
    if (typeof body.content === 'string') {
      bundle[type] = body.content;
    } else if (typeof body.log === 'string') {
      bundle[type] = body.log;
    } else if (Array.isArray(body.records)) {
      bundle[type] = body.records.map((r) => JSON.stringify(r)).join('\n');
    }
  }

  return bundle;
}

export function bundleHasData(bundle) {
  return ZEEK_LOG_TYPES.some((t) => (bundle[t] ?? '').trim().length > 0);
}
