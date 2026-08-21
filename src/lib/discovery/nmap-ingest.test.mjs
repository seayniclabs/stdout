import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';

// Force database path for the test
const TEST_DB_PATH = './data/stdout-test.db';
process.env.DB_PATH = TEST_DB_PATH;

test.describe('Nmap Ingestion API Endpoint Integration', () => {
  let sqlite;
  
  test.before(() => {
    // 1. Clean up any stale test database
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
      try { fs.unlinkSync(`${TEST_DB_PATH}-shm`); } catch {}
      try { fs.unlinkSync(`${TEST_DB_PATH}-wal`); } catch {}
    }
    
    // 2. Run migrations to create schema
    console.log('[test] Running migrations on test DB...');
    execSync(`DB_PATH=${TEST_DB_PATH} /opt/homebrew/bin/node scripts/migrate.js`, { stdio: 'inherit' });
    
    // 3. Connect to the test DB and insert a test user
    sqlite = new Database(TEST_DB_PATH);
    sqlite.prepare(`
      INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('user_test_123', 'test@example.com', 'dummyhash', 'admin', Date.now(), Date.now());
  });

  test.after(() => {
    if (sqlite) {
      sqlite.close();
    }
    // Clean up test DB files
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
      try { fs.unlinkSync(`${TEST_DB_PATH}-shm`); } catch {}
      try { fs.unlinkSync(`${TEST_DB_PATH}-wal`); } catch {}
    }
  });

  test('POST /app/api/discovery/ingest successfully ingests XML payload', async () => {
    const { POST } = await import('../../pages/app/api/discovery/ingest.ts');
    
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sV 192.168.0.1" start="1700000000" version="7.93">
  <host>
    <status state="up" reason="arp-response"/>
    <address addr="192.168.0.22" addrtype="ipv4"/>
    <address addr="aa:bb:cc:11:22:33" addrtype="mac" vendor="Google"/>
    <hostnames>
      <hostname name="google-home" type="user"/>
    </hostnames>
    <ports>
      <port protocol="tcp" portid="8009">
        <state state="open" reason="syn-ack"/>
        <service name="chromecast" product="Google Chromecast" version="1.56"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

    // Mock request
    const request = new Request('http://localhost/app/api/discovery/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml'
      },
      body: xmlPayload
    });

    const locals = {
      user: { id: 'user_test_123' }
    };

    // Run endpoint handler
    const response = await POST({ request, locals });
    assert.strictEqual(response.status, 201);
    
    const resBody = await response.json();
    assert.strictEqual(resBody.success, true);
    assert.strictEqual(resBody.hostsIngested, 1);
    assert.strictEqual(resBody.servicesIngested, 1);

    // Verify database records
    const hostRow = sqlite.prepare("SELECT * FROM discovered_hosts WHERE ip_address = '192.168.0.22'").get();
    assert.ok(hostRow);
    assert.strictEqual(hostRow.ip_address, '192.168.0.22');
    assert.strictEqual(hostRow.hostname, 'google-home');
    assert.strictEqual(hostRow.mac_address, 'aa:bb:cc:11:22:33');
    assert.strictEqual(hostRow.vendor, 'Google');
    assert.strictEqual(hostRow.device_type, 'host');

    const serviceRow = sqlite.prepare("SELECT * FROM discovered_services WHERE host_id = ?").get(hostRow.id);
    assert.ok(serviceRow);
    assert.strictEqual(serviceRow.port, 8009);
    assert.strictEqual(serviceRow.protocol, 'tcp');
    assert.strictEqual(serviceRow.service_name, 'chromecast');
    assert.strictEqual(serviceRow.service_version, 'Google Chromecast 1.56');

    // Verify entity graph
    const deviceEntity = sqlite.prepare("SELECT * FROM entities WHERE type = 'device'").get();
    assert.ok(deviceEntity);
    assert.strictEqual(deviceEntity.name, 'google-home');
    const deviceProps = JSON.parse(deviceEntity.properties);
    assert.strictEqual(deviceProps.ip, '192.168.0.22');
    assert.strictEqual(deviceProps.vendor, 'Google');

    const serviceEntity = sqlite.prepare("SELECT * FROM entities WHERE type = 'service'").get();
    assert.ok(serviceEntity);
    assert.strictEqual(serviceEntity.name, 'chromecast (8009/tcp)');
    const serviceProps = JSON.parse(serviceEntity.properties);
    assert.strictEqual(serviceProps.port, 8009);
    assert.strictEqual(serviceProps.serviceName, 'chromecast');

    const relationship = sqlite.prepare("SELECT * FROM entity_relationships").get();
    assert.ok(relationship);
    assert.strictEqual(relationship.source_id, serviceEntity.id);
    assert.strictEqual(relationship.target_id, deviceEntity.id);
    assert.strictEqual(relationship.type, 'runs_on');
    const relMeta = JSON.parse(relationship.metadata);
    assert.strictEqual(relMeta.port, 8009);
  });
});
