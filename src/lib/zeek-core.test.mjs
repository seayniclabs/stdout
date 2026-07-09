import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseZeekBundle,
  aggregateZeekMetrics,
  correlateZeekLogs,
  bundleFromBody,
  bundleHasData,
} from './zeek-core.mjs';

const CONN_TSV = `#path	conn
#fields	ts	uid	id.orig_h	id.orig_p	id.resp_h	id.resp_p	proto	service	duration	orig_bytes	resp_bytes	conn_state	history
1710000000.1	C1	192.168.1.10	54321	8.8.8.8	53	udp	dns	0.05	40	80	SF	Dd
1710000000.2	C2	192.168.1.10	54322	1.2.3.4	443	tcp	ssl	1.2	100	200	SF	ShADadfF
1710000000.3	C3	10.0.0.5	40000	10.0.0.9	22	tcp	-	0.0	0	0	REJ	Rej
`;

const DNS_TSV = `#path	dns
#fields	ts	uid	id.orig_h	id.resp_h	query	qtype_name	rcode_name
1710000000.1	C1	192.168.1.10	8.8.8.8	example.com	A	NOERROR
1710000000.2	C4	192.168.1.10	8.8.8.8	evil.invalid	A	NXDOMAIN
`;

const HTTP_JSONL = [
  JSON.stringify({ ts: 1710000000.1, uid: 'C5', 'id.orig_h': '192.168.1.10', 'id.resp_h': '1.2.3.4', status_code: 200 }),
  JSON.stringify({ ts: 1710000000.2, uid: 'C6', 'id.orig_h': '192.168.1.10', 'id.resp_h': '1.2.3.4', status_code: 500 }),
].join('\n');

const SSL_JSONL = JSON.stringify({
  ts: 1710000000.2,
  uid: 'C2',
  'id.orig_h': '192.168.1.10',
  'id.resp_h': '1.2.3.4',
  validation_status: 'self signed certificate',
});

const NOTICE_TSV = `#path	notice
#fields	ts	uid	id.orig_h	id.resp_h	note	msg	src	dst
1710000000.3	C3	10.0.0.5	10.0.0.9	Scan::Port_Scan	Port scan from 10.0.0.5	10.0.0.5	10.0.0.9
`;

test('parseZeekBundle reads TSV and JSONL for all protocol types', () => {
  const byType = parseZeekBundle({
    conn: CONN_TSV,
    dns: DNS_TSV,
    http: HTTP_JSONL,
    ssl: SSL_JSONL,
    notice: NOTICE_TSV,
  });
  assert.equal(byType.conn.length, 3);
  assert.equal(byType.dns.length, 2);
  assert.equal(byType.http.length, 2);
  assert.equal(byType.ssl.length, 1);
  assert.equal(byType.notice.length, 1);
  assert.equal(byType.conn[2].conn_state, 'REJ');
});

test('aggregateZeekMetrics counts failures, nxdomain, http errors, ssl fails', () => {
  const byType = parseZeekBundle({
    conn: CONN_TSV,
    dns: DNS_TSV,
    http: HTTP_JSONL,
    ssl: SSL_JSONL,
    notice: NOTICE_TSV,
  });
  const m = aggregateZeekMetrics(byType);
  assert.equal(m.zeek_conn_total, 3);
  assert.equal(m.zeek_conn_failed, 1);
  assert.equal(m.zeek_conn_bytes_orig, 140);
  assert.equal(m.zeek_dns_queries, 2);
  assert.equal(m.zeek_dns_nxdomain, 1);
  assert.equal(m.zeek_http_requests, 2);
  assert.equal(m.zeek_http_errors, 1);
  assert.equal(m.zeek_ssl_connections, 1);
  assert.equal(m.zeek_ssl_validation_fail, 1);
  assert.equal(m.zeek_notice_count, 1);
});

test('correlateZeekLogs links notice to conn by uid/IP', () => {
  const byType = parseZeekBundle({
    conn: CONN_TSV,
    dns: DNS_TSV,
    http: HTTP_JSONL,
    ssl: SSL_JSONL,
    notice: NOTICE_TSV,
  });
  const correlations = correlateZeekLogs(byType);
  assert.equal(correlations.length, 1);
  assert.equal(correlations[0].noticeNote, 'Scan::Port_Scan');
  assert.equal(correlations[0].noticeSeverity, 'critical');
  assert.ok(correlations[0].relatedConn >= 1);
  assert.ok(correlations[0].riskScore >= 55);
  assert.match(correlations[0].summary, /src=10\.0\.0\.5/);
});

test('bundleFromBody accepts nested logs and single-type shapes', () => {
  const a = bundleFromBody({ logs: { conn: CONN_TSV } });
  assert.ok(bundleHasData(a));
  assert.equal(a.conn, CONN_TSV);

  const b = bundleFromBody({ type: 'dns', content: DNS_TSV });
  assert.equal(b.dns, DNS_TSV);

  const c = bundleFromBody({ type: 'http', records: [{ status_code: 404 }] });
  assert.match(c.http, /404/);

  assert.equal(bundleHasData({}), false);
});
