/**
 * Passive Discovery Engine
 *
 * Discovers infrastructure without active network scanning.
 * Safe for managed networks, EDR/IDS environments, and segmented VLANs.
 *
 * Discovery Methods:
 * 1. Docker API - containers on local host
 * 2. Systemd DBus - services on Linux host
 * 3. /proc watching - running processes
 * 4. DNS-SD - mDNS/Bonjour services
 */

import { getSqlite } from '../db';

export interface DiscoveredApp {
  id: string;
  name: string;
  type: 'docker' | 'systemd' | 'process' | 'mdns' | 'manual';
  host: string;
  port?: number;
  logSource?: 'docker-api' | 'journalctl' | 'file' | 'syslog' | 'http-api';
  logPath?: string;
  status: 'discovered' | 'configuring' | 'active' | 'error';
  metadata: Record<string, any>;
  discovered_at: number;
  updated_at: number;
}

/**
 * Discover Docker containers via Docker API
 */
export async function discoverDockerContainers(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];

  try {
    // Check if Docker socket is available
    const dockerSocketPaths = [
      '/var/run/docker.sock',           // Linux
      '/run/docker.sock',                // Some Linux distros
      process.env.DOCKER_HOST?.replace('unix://', '') || '',
    ].filter(Boolean);

    let dockerAvailable = false;
    for (const socketPath of dockerSocketPaths) {
      try {
        const fs = await import('fs/promises');
        await fs.access(socketPath);
        dockerAvailable = true;
        break;
      } catch {
        continue;
      }
    }

    if (!dockerAvailable) {
      console.log('[Discovery] Docker socket not available - skipping Docker discovery');
      return apps;
    }

    // Query Docker API for running containers
    const response = await fetch('http://localhost/containers/json', {
      socketPath: '/var/run/docker.sock',
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Docker API error: ${response.status}`);
    }

    const containers = await response.json();

    for (const container of containers) {
      const name = container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12);
      const image = container.Image;
      const ports = container.Ports || [];

      // Detect application type from image name
      let appType = 'unknown';
      if (image.includes('postgres')) appType = 'postgresql';
      else if (image.includes('redis')) appType = 'redis';
      else if (image.includes('nginx')) appType = 'nginx';
      else if (image.includes('mysql') || image.includes('mariadb')) appType = 'mysql';
      else if (image.includes('mongo')) appType = 'mongodb';
      else if (image.includes('node')) appType = 'nodejs';

      apps.push({
        id: `docker_${container.Id}`,
        name,
        type: 'docker',
        host: 'localhost',
        port: ports[0]?.PublicPort,
        logSource: 'docker-api',
        status: 'discovered',
        metadata: {
          containerId: container.Id,
          image,
          appType,
          state: container.State,
          created: container.Created,
        },
        discovered_at: Date.now(),
        updated_at: Date.now(),
      });
    }

    console.log(`[Discovery] Found ${apps.length} Docker containers`);
  } catch (error) {
    console.error('[Discovery] Docker discovery failed:', error);
  }

  return apps;
}

/**
 * Discover systemd services (Linux only)
 */
export async function discoverSystemdServices(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];

  try {
    // Check if we're on Linux with systemd
    if (process.platform !== 'linux') {
      console.log('[Discovery] Not Linux - skipping systemd discovery');
      return apps;
    }

    // Check if systemctl is available
    const { execFileSync } = await import('child_process');
    try {
      execFileSync('which', ['systemctl'], { stdio: 'ignore' });
    } catch {
      console.log('[Discovery] systemctl not available - skipping systemd discovery');
      return apps;
    }

    // List active services
    const output = execFileSync('systemctl', [
      'list-units',
      '--type=service',
      '--state=running',
      '--no-pager',
      '--plain'
    ], {
      encoding: 'utf-8',
    });

    const lines = output.split('\n').slice(1); // Skip header

    for (const line of lines) {
      const match = line.trim().match(/^(\S+\.service)\s+loaded\s+active\s+running\s+(.+)$/);
      if (!match) continue;

      const [, serviceName, description] = match;
      const name = serviceName.replace('.service', '');

      // Skip system services (focus on applications)
      const systemServices = ['systemd', 'dbus', 'network', 'ssh', 'cron', 'rsyslog'];
      if (systemServices.some(s => name.startsWith(s))) continue;

      apps.push({
        id: `systemd_${name}`,
        name,
        type: 'systemd',
        host: 'localhost',
        logSource: 'journalctl',
        status: 'discovered',
        metadata: {
          serviceName,
          description: description.trim(),
        },
        discovered_at: Date.now(),
        updated_at: Date.now(),
      });
    }

    console.log(`[Discovery] Found ${apps.length} systemd services`);
  } catch (error) {
    console.error('[Discovery] Systemd discovery failed:', error);
  }

  return apps;
}

/**
 * Discover running processes (lightweight)
 */
export async function discoverProcesses(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];

  try {
    const { execFileSync } = await import('child_process');

    // Get processes listening on network ports
    let psOutput: string;
    if (process.platform === 'linux') {
      try {
        psOutput = execFileSync('ss', ['-tlnp'], { encoding: 'utf-8' });
      } catch {
        try {
          psOutput = execFileSync('netstat', ['-tlnp'], { encoding: 'utf-8' });
        } catch {
          console.log('[Discovery] Neither ss nor netstat available - skipping process discovery');
          return apps;
        }
      }
    } else if (process.platform === 'darwin') {
      try {
        psOutput = execFileSync('lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P'], { encoding: 'utf-8' });
      } catch {
        console.log('[Discovery] lsof failed - skipping process discovery');
        return apps;
      }
    } else {
      console.log('[Discovery] Process discovery not supported on this platform');
      return apps;
    }

    // Parse output (simplified - real parser would be more robust)
    const lines = psOutput.split('\n');
    const seen = new Set<string>();

    for (const line of lines) {
      // Extract process name and port (simplified)
      const portMatch = line.match(/:(\d+)\s/);
      const processMatch = line.match(/users:\(\("([^"]+)"/);

      if (portMatch && processMatch) {
        const port = parseInt(portMatch[1]);
        const processName = processMatch[1];

        // Skip if already seen or system process
        const key = `${processName}:${port}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (['systemd', 'sshd', 'dhcpd'].includes(processName)) continue;

        apps.push({
          id: `process_${processName}_${port}`,
          name: processName,
          type: 'process',
          host: 'localhost',
          port,
          status: 'discovered',
          metadata: {
            processName,
            port,
          },
          discovered_at: Date.now(),
          updated_at: Date.now(),
        });
      }
    }

    console.log(`[Discovery] Found ${apps.length} network processes`);
  } catch (error) {
    console.error('[Discovery] Process discovery failed:', error);
  }

  return apps;
}

/**
 * Run full passive discovery sweep
 */
export async function runPassiveDiscovery(): Promise<DiscoveredApp[]> {
  console.log('[Discovery] Starting passive discovery...');

  const [dockerApps, systemdApps, processApps] = await Promise.all([
    discoverDockerContainers(),
    discoverSystemdServices(),
    discoverProcesses(),
  ]);

  const allApps = [...dockerApps, ...systemdApps, ...processApps];

  // Store in database
  const db = getSqlite();

  // Create discovered_apps table if it doesn't exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS discovered_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER,
      log_source TEXT,
      log_path TEXT,
      status TEXT NOT NULL,
      metadata TEXT,
      discovered_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  // Upsert discovered apps
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO discovered_apps
    (id, name, type, host, port, log_source, log_path, status, metadata, discovered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const app of allApps) {
    upsert.run(
      app.id,
      app.name,
      app.type,
      app.host,
      app.port || null,
      app.logSource || null,
      app.logPath || null,
      app.status,
      JSON.stringify(app.metadata),
      app.discovered_at,
      app.updated_at
    );
  }

  console.log(`[Discovery] Stored ${allApps.length} discovered applications`);

  return allApps;
}

/**
 * Get all discovered applications
 */
export function getDiscoveredApps(): DiscoveredApp[] {
  const db = getSqlite();

  try {
    const rows = db.prepare(`
      SELECT * FROM discovered_apps ORDER BY name ASC
    `).all() as Array<{
      id: string;
      name: string;
      type: string;
      host: string;
      port: number | null;
      log_source: string | null;
      log_path: string | null;
      status: string;
      metadata: string;
      discovered_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type as any,
      host: row.host,
      port: row.port || undefined,
      logSource: row.log_source as any,
      logPath: row.log_path || undefined,
      status: row.status as any,
      metadata: JSON.parse(row.metadata),
      discovered_at: row.discovered_at,
      updated_at: row.updated_at,
    }));
  } catch {
    return [];
  }
}
