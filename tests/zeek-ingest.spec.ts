import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

const CONN_TSV = `#separator \\x09
#path	conn
#fields	ts	uid	id.orig_h	id.orig_p	id.resp_h	id.resp_p	proto	service	duration	orig_bytes	resp_bytes	conn_state	history
#types	time	string	addr	port	addr	port	enum	string	interval	count	count	string	string
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
  JSON.stringify({ ts: 1710000000.1, uid: 'C5', 'id.orig_h': '192.168.1.10', 'id.resp_h': '1.2.3.4', status_code: 200, method: 'GET' }),
  JSON.stringify({ ts: 1710000000.2, uid: 'C6', 'id.orig_h': '192.168.1.10', 'id.resp_h': '1.2.3.4', status_code: 500, method: 'POST' }),
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

test.describe('Zeek protocol log ingest (TOOL3)', () => {
  test('ZK1 — rejects unauthenticated requests', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonResp = await anon.request.post('/app/api/zeek/ingest', {
      data: { conn: CONN_TSV },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(anonResp.status());
    await anon.close();
  });

  test('ZK2 — dryRun parses TSV + JSONL and correlates notices', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/zeek/ingest?dryRun=1', {
      conn: CONN_TSV,
      dns: DNS_TSV,
      http: HTTP_JSONL,
      ssl: SSL_JSONL,
      notice: NOTICE_TSV,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.recordsParsed.conn).toBe(3);
    expect(json.recordsParsed.dns).toBe(2);
    expect(json.recordsParsed.http).toBe(2);
    expect(json.recordsParsed.ssl).toBe(1);
    expect(json.recordsParsed.notice).toBe(1);
    expect(json.metrics.zeek_conn_total).toBe(3);
    expect(json.metrics.zeek_conn_failed).toBe(1);
    expect(json.metrics.zeek_dns_nxdomain).toBe(1);
    expect(json.metrics.zeek_http_errors).toBe(1);
    expect(json.metrics.zeek_ssl_validation_fail).toBe(1);
    expect(json.metrics.zeek_notice_count).toBe(1);
    expect(json.correlations.length).toBe(1);
    expect(json.correlations[0].noticeNote).toBe('Scan::Port_Scan');
    expect(json.correlations[0].relatedConn).toBeGreaterThanOrEqual(1);
    expect(json.correlations[0].riskScore).toBeGreaterThanOrEqual(55);
  });

  test('ZK3 — single-type body shape', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/zeek/ingest?dryRun=1', {
      type: 'dns',
      content: DNS_TSV,
    });
    expect(status).toBe(200);
    expect(json.metrics.zeek_dns_queries).toBe(2);
    expect(json.metrics.zeek_dns_nxdomain).toBe(1);
  });

  test('ZK4 — bearer token ingests and updates baselines', async ({ page }) => {
    await createAuthenticatedUser(page);

    const createResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'zeek_ingest_token',
    });
    const rawToken = createResult.json.token;
    expect(rawToken).toMatch(/^stdout_scan_/);

    const response = await page.request.post('/app/api/zeek/ingest?noIncidents=1', {
      data: {
        conn: CONN_TSV,
        dns: DNS_TSV,
        http: HTTP_JSONL,
        ssl: SSL_JSONL,
        notice: NOTICE_TSV,
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawToken}`,
      },
    });

    expect(response.status()).toBe(201);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.baselinesUpdated).toBeGreaterThan(0);
    expect(json.metrics.zeek_conn_total).toBe(3);
    expect(json.incidentIds).toEqual([]);
  });

  test('ZK5 — rejects empty payload', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/zeek/ingest', {});
    expect(status).toBe(400);
    expect(json.error).toMatch(/No Zeek log data/i);
  });
});
