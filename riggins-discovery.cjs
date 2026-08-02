/**
 * Riggins Auto-Discovery Engine
 *
 * Automatically discovers network devices and services
 * Populates device inventory database
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'inventory.db');

/**
 * Initialize inventory database
 */
function initDatabase() {
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      hostname TEXT,
      mac_address TEXT,
      vendor TEXT,
      status TEXT DEFAULT 'up',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      scan_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      port INTEGER NOT NULL,
      protocol TEXT DEFAULT 'tcp',
      service_name TEXT,
      service_version TEXT,
      detected_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id),
      UNIQUE(device_id, port, protocol)
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_type TEXT NOT NULL,
      network_range TEXT NOT NULL,
      devices_found INTEGER DEFAULT 0,
      new_devices INTEGER DEFAULT 0,
      missing_devices INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    CREATE INDEX IF NOT EXISTS idx_services_device ON services(device_id);
  `);

  return db;
}

/**
 * Scan network for devices using nmap
 */
async function scanNetwork(networkRange = '192.168.68.0/24') {
  console.log(`[Discovery] Scanning network: ${networkRange}`);

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const db = initDatabase();

  // Record scan start
  const scanInfo = db.prepare(`
    INSERT INTO scan_history (scan_type, network_range, started_at)
    VALUES (?, ?, ?)
  `).run('full', networkRange, timestamp);

  const scanId = scanInfo.lastInsertRowid;

  try {
    // Run nmap scan (requires nmap installed)
    // -sn: Ping scan (no port scan)
    // -oX -: Output XML to stdout
    const { stdout } = await execPromise(
      `nmap -sn -oX - ${networkRange}`
    );

    // Parse XML output (simplified - real impl would use xml2js)
    const devices = parseNmapOutput(stdout);

    let newDevices = 0;
    let existingDevices = 0;

    for (const device of devices) {
      const existing = db.prepare('SELECT id FROM devices WHERE ip = ?').get(device.ip);

      if (existing) {
        // Update last_seen and increment scan_count
        db.prepare(`
          UPDATE devices
          SET last_seen = ?, scan_count = scan_count + 1, status = 'up'
          WHERE ip = ?
        `).run(timestamp, device.ip);
        existingDevices++;
      } else {
        // Insert new device
        db.prepare(`
          INSERT INTO devices (ip, hostname, mac_address, vendor, first_seen, last_seen)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          device.ip,
          device.hostname || null,
          device.mac || null,
          device.vendor || null,
          timestamp,
          timestamp
        );
        newDevices++;
      }
    }

    // Mark devices not seen as 'down'
    const devicesInScan = devices.map(d => d.ip);
    if (devicesInScan.length > 0) {
      const placeholders = devicesInScan.map(() => '?').join(',');
      db.prepare(`
        UPDATE devices
        SET status = 'down'
        WHERE ip NOT IN (${placeholders})
        AND status = 'up'
      `).run(...devicesInScan);
    }

    const durationMs = Date.now() - startTime;

    // Update scan history
    db.prepare(`
      UPDATE scan_history
      SET devices_found = ?, new_devices = ?, completed_at = ?, duration_ms = ?
      WHERE id = ?
    `).run(devices.length, newDevices, new Date().toISOString(), durationMs, scanId);

    console.log(`[Discovery] Scan complete: ${devices.length} devices found (${newDevices} new, ${existingDevices} existing)`);

    db.close();

    return {
      scanId,
      devicesFound: devices.length,
      newDevices,
      existingDevices,
      durationMs
    };
  } catch (error) {
    // Record failure
    db.prepare(`
      UPDATE scan_history
      SET completed_at = ?, duration_ms = ?
      WHERE id = ?
    `).run(new Date().toISOString(), Date.now() - startTime, scanId);

    db.close();

    throw error;
  }
}

/**
 * Service fingerprinting for a specific device
 */
async function scanServices(deviceIp) {
  console.log(`[Discovery] Scanning services on ${deviceIp}`);

  const db = initDatabase();

  // Get device ID
  const device = db.prepare('SELECT id FROM devices WHERE ip = ?').get(deviceIp);
  if (!device) {
    throw new Error(`Device not found: ${deviceIp}`);
  }

  try {
    // Run nmap service scan
    // -sV: Version detection
    // --top-ports 100: Scan most common 100 ports
    const { stdout } = await execPromise(
      `nmap -sV --top-ports 100 -oX - ${deviceIp}`
    );

    const services = parseServiceOutput(stdout);

    const timestamp = new Date().toISOString();

    for (const service of services) {
      // Upsert service
      db.prepare(`
        INSERT INTO services (device_id, port, protocol, service_name, service_version, detected_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, port, protocol) DO UPDATE SET
          service_name = excluded.service_name,
          service_version = excluded.service_version,
          detected_at = excluded.detected_at
      `).run(
        device.id,
        service.port,
        service.protocol || 'tcp',
        service.name || null,
        service.version || null,
        timestamp
      );
    }

    console.log(`[Discovery] Found ${services.length} services on ${deviceIp}`);

    db.close();

    return services;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Parse nmap XML output (simplified)
 */
function parseNmapOutput(xml) {
  const devices = [];

  // Extract IP addresses (simplified regex parsing)
  const hostRegex = /<address addr="([^"]+)" addrtype="ipv4"/g;
  const hostnameRegex = /<hostname name="([^"]+)"/g;
  const macRegex = /<address addr="([^"]+)" addrtype="mac" vendor="([^"]*)"/g;

  let match;
  const ips = [];

  while ((match = hostRegex.exec(xml)) !== null) {
    ips.push(match[1]);
  }

  const hostnames = [];
  while ((match = hostnameRegex.exec(xml)) !== null) {
    hostnames.push(match[1]);
  }

  const macs = [];
  const vendors = [];
  while ((match = macRegex.exec(xml)) !== null) {
    macs.push(match[1]);
    vendors.push(match[2]);
  }

  // Combine (simplified - real impl would parse XML properly)
  ips.forEach((ip, i) => {
    devices.push({
      ip,
      hostname: hostnames[i] || null,
      mac: macs[i] || null,
      vendor: vendors[i] || null
    });
  });

  return devices;
}

/**
 * Parse nmap service scan output
 */
function parseServiceOutput(xml) {
  const services = [];

  // Extract ports and services (simplified)
  const portRegex = /<port protocol="([^"]+)" portid="(\d+)"><state state="open"\/><service name="([^"]*)" product="([^"]*)" version="([^"]*)"/g;

  let match;
  while ((match = portRegex.exec(xml)) !== null) {
    services.push({
      protocol: match[1],
      port: parseInt(match[2]),
      name: match[3] || null,
      product: match[4] || null,
      version: match[5] || null
    });
  }

  return services;
}

/**
 * Get device inventory summary
 */
function getInventorySummary() {
  const db = initDatabase();

  const summary = {
    totalDevices: db.prepare('SELECT COUNT(*) as count FROM devices').get().count,
    activeDevices: db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'up'").get().count,
    inactiveDevices: db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'down'").get().count,
    totalServices: db.prepare('SELECT COUNT(*) as count FROM services').get().count,
    lastScan: db.prepare('SELECT MAX(completed_at) as last FROM scan_history WHERE completed_at IS NOT NULL').get().last
  };

  db.close();

  return summary;
}

/**
 * Get all devices
 */
function getAllDevices() {
  const db = initDatabase();

  const devices = db.prepare(`
    SELECT
      d.*,
      COUNT(s.id) as service_count
    FROM devices d
    LEFT JOIN services s ON s.device_id = d.id
    GROUP BY d.id
    ORDER BY d.last_seen DESC
  `).all();

  db.close();

  return devices;
}

/**
 * Background scanner (runs every 6 hours)
 */
async function startBackgroundScanner(interval = 6 * 60 * 60 * 1000) {
  console.log(`[Discovery] Starting background scanner (interval: ${interval / 1000}s)`);

  const runScan = async () => {
    try {
      await scanNetwork();
    } catch (error) {
      console.error('[Discovery] Background scan failed:', error.message);
    }
  };

  // Initial scan
  await runScan();

  // Schedule periodic scans
  setInterval(runScan, interval);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'init') {
    console.log('Initializing database...');
    initDatabase();
    console.log('✓ Database initialized');
  } else if (command === 'scan') {
    const networkRange = args[1] || '192.168.68.0/24';
    scanNetwork(networkRange).then(result => {
      console.log('\n✓ Scan complete:', result);
    }).catch(error => {
      console.error('Scan failed:', error.message);
      process.exit(1);
    });
  } else if (command === 'services') {
    const deviceIp = args[1];
    if (!deviceIp) {
      console.error('Usage: node riggins-discovery.js services <device-ip>');
      process.exit(1);
    }
    scanServices(deviceIp).then(services => {
      console.log('\n✓ Services found:', services);
    }).catch(error => {
      console.error('Service scan failed:', error.message);
      process.exit(1);
    });
  } else if (command === 'list') {
    const devices = getAllDevices();
    console.log('\nInventory:\n');
    devices.forEach(d => {
      console.log(`  ${d.ip.padEnd(15)} ${(d.hostname || '—').padEnd(30)} ${d.status.padEnd(8)} ${d.service_count} services`);
    });
    console.log(`\nTotal: ${devices.length} devices`);
  } else if (command === 'summary') {
    const summary = getInventorySummary();
    console.log('\nInventory Summary:\n');
    console.log(`  Total devices:    ${summary.totalDevices}`);
    console.log(`  Active (up):      ${summary.activeDevices}`);
    console.log(`  Inactive (down):  ${summary.inactiveDevices}`);
    console.log(`  Total services:   ${summary.totalServices}`);
    console.log(`  Last scan:        ${summary.lastScan || 'Never'}`);
  } else if (command === 'daemon') {
    startBackgroundScanner();
  } else {
    console.log('Riggins Auto-Discovery\n');
    console.log('Usage:');
    console.log('  init                     - Initialize database');
    console.log('  scan [network-range]     - Scan network for devices');
    console.log('  services <device-ip>     - Scan services on specific device');
    console.log('  list                     - List all devices');
    console.log('  summary                  - Show inventory summary');
    console.log('  daemon                   - Run background scanner (6h interval)');
  }
}

module.exports = {
  initDatabase,
  scanNetwork,
  scanServices,
  getInventorySummary,
  getAllDevices,
  startBackgroundScanner
};
