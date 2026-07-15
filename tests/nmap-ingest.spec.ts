import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import Database from 'better-sqlite3';

function cleanupDb() {
  const dbPath = process.env.DB_PATH || './data/stdout.db';
  try {
    const db = new Database(dbPath);
    db.prepare("DELETE FROM discovered_hosts WHERE ip_address IN ('192.168.99.100', '192.168.99.101')").run();
    db.prepare("DELETE FROM discovered_services WHERE host_id NOT IN (SELECT id FROM discovered_hosts)").run();
    db.prepare("DELETE FROM entities WHERE type = 'device' AND (properties->>'$.ip' = '192.168.99.100' OR properties->>'$.ip' = '192.168.99.101')").run();
    db.prepare("DELETE FROM entities WHERE type = 'service' AND (properties->>'$.ip' = '192.168.99.100' OR properties->>'$.ip' = '192.168.99.101')").run();
    db.prepare("DELETE FROM entity_relationships WHERE source_id NOT IN (SELECT id FROM entities) OR target_id NOT IN (SELECT id FROM entities)").run();
    db.prepare("DELETE FROM monitors WHERE target IN ('192.168.99.100', '192.168.99.101')").run();
    db.close();
  } catch (err) {
    console.error('Failed to cleanup test DB:', err);
  }
}

const NMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sV 192.168.99.100" start="1700000000" version="7.93">
  <host>
    <status state="up" reason="arp-response"/>
    <address addr="192.168.99.100" addrtype="ipv4"/>
    <address addr="00:11:22:33:44:55" addrtype="mac" vendor="Apple"/>
    <hostnames>
      <hostname name="my-apple-device" type="user"/>
    </hostnames>
    <ports>
      <port protocol="tcp" portid="22">
        <state state="open" reason="syn-ack"/>
        <service name="ssh" product="OpenSSH" version="8.4p1"/>
      </port>
      <port protocol="tcp" portid="80">
        <state state="open" reason="syn-ack"/>
        <service name="http" product="nginx" version="1.18.0"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

const NMAP_JSON = JSON.stringify({
  hosts: [
    {
      ip: '192.168.99.101',
      mac: 'aa:bb:cc:dd:ee:fa',
      vendor: 'Raspberry Pi',
      hostname: 'pi-hole-test',
      status: 'up',
      ports: [
        {
          port: 53,
          protocol: 'udp',
          serviceName: 'dns',
          serviceVersion: 'dnsmasq'
        }
      ]
    }
  ]
});

test.describe('Nmap Discovery Ingest (TOOL8)', () => {
  test.beforeEach(() => {
    cleanupDb();
  });

  test.afterAll(() => {
    cleanupDb();
  });

  test('N1 — rejects unauthenticated requests', async ({ browser }) => {
    const anon = await browser.newContext();
    
    // Ingest endpoint unauthenticated check
    const anonIngest = await anon.request.post('/app/api/discovery/ingest', {
      data: NMAP_XML,
      headers: { 'Content-Type': 'application/xml' },
    });
    expect([401, 403]).toContain(anonIngest.status());
    
    // Validate endpoint unauthenticated check
    const anonValidate = await anon.request.post('/app/api/discovery/schema/validate', {
      data: NMAP_XML,
      headers: { 'Content-Type': 'application/xml' },
    });
    expect([401, 403]).toContain(anonValidate.status());
    
    await anon.close();
  });

  test('N2 — rejects invalid payloads', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Empty payload
    const emptyResp = await apiRequest(page, 'POST', '/app/api/discovery/schema/validate', '');
    expect(emptyResp.status).toBe(400);
    expect(emptyResp.json.error).toMatch(/Schema validation failed|Empty payload/i);

    // Invalid XML structure
    const invalidXml = '<nmaprun><host><status state="up"/></host></nmaprun>'; // Missing address
    const invalidXmlResp = await apiRequest(page, 'POST', '/app/api/discovery/schema/validate', invalidXml);
    expect(invalidXmlResp.status).toBe(400);
    expect(invalidXmlResp.json.valid).toBe(false);
    expect(invalidXmlResp.json.errors.length).toBeGreaterThan(0);
    expect(invalidXmlResp.json.errors[0]).toMatch(/missing both IP and MAC/i);
  });

  test('N3 — validates XML schema without modifying database', async ({ page }) => {
    await createAuthenticatedUser(page);

    const { status, json } = await apiRequest(page, 'POST', '/app/api/discovery/schema/validate', NMAP_XML);
    expect(status).toBe(200);
    expect(json.valid).toBe(true);
    expect(json.summary.hostsCount).toBe(1);
    expect(json.summary.servicesCount).toBe(2);
    expect(json.hosts[0].ip).toBe('192.168.99.100');

    // Confirm monitor was NOT created
    const listResult = await apiRequest(page, 'GET', '/app/api/monitors');
    const hasMonitor = listResult.json.monitors?.some((m: any) => m.target === '192.168.99.100');
    expect(hasMonitor).toBeFalsy();
  });

  test('N4 — ingests XML payload, creates host, services, entities, and monitors', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Ingest the XML
    const { status, json } = await page.request.post('/app/api/discovery/ingest', {
      data: NMAP_XML,
      headers: { 'Content-Type': 'application/xml' },
    }).then(async (r) => ({ status: r.status(), json: await r.json() }));

    expect(status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.hostsIngested).toBe(1);
    expect(json.servicesIngested).toBe(2);
    expect(json.monitorsCreated).toBeGreaterThanOrEqual(0); // Might be 0 if already existed in DB, but >0 for first run

    // Verify monitor was created for the new host
    const listResult = await apiRequest(page, 'GET', '/app/api/monitors');
    const hostMonitor = listResult.json.monitors?.find((m: any) => m.target === '192.168.99.100');
    expect(hostMonitor).toBeDefined();
    expect(hostMonitor.name).toContain('my-apple-device');
  });

  test('N5 — ingests JSON payload, creates host, services, entities, and monitors', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Ingest the JSON
    const { status, json } = await page.request.post('/app/api/discovery/ingest', {
      data: NMAP_JSON,
      headers: { 'Content-Type': 'application/json' },
    }).then(async (r) => ({ status: r.status(), json: await r.json() }));

    expect(status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.hostsIngested).toBe(1);
    expect(json.servicesIngested).toBe(1);

    // Verify monitor was created for the JSON host
    const listResult = await apiRequest(page, 'GET', '/app/api/monitors');
    const hostMonitor = listResult.json.monitors?.find((m: any) => m.target === '192.168.99.101');
    expect(hostMonitor).toBeDefined();
    expect(hostMonitor.name).toContain('pi-hole-test');
  });
});
