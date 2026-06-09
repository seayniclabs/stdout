import type { APIRoute } from 'astro';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Background service scanner
 *
 * Runs deep nmap port scans on discovered hosts to detect services.
 * This is async and silent - runs after the wizard completes.
 *
 * Called automatically after setup OR manually from infrastructure page.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await request.json();
  const hosts = body.hosts || []; // Array of {ip, hostname?}

  console.log('[scan-services] Starting background service scan for', hosts.length, 'hosts');

  // Run in background - don't wait for completion
  scanServicesInBackground(hosts).catch(err => {
    console.error('[scan-services] Background scan failed:', err);
  });

  return new Response(
    JSON.stringify({
      status: 'started',
      hosts: hosts.length,
      message: 'Service scan started in background'
    }),
    {
      status: 202, // Accepted
      headers: { 'Content-Type': 'application/json' }
    }
  );
};

async function scanServicesInBackground(hosts: Array<{ ip: string; hostname?: string }>) {
  const COMMON_PORTS = [
    { port: 22, service: 'SSH' },
    { port: 80, service: 'HTTP' },
    { port: 443, service: 'HTTPS' },
    { port: 3000, service: 'Node.js/React Dev' },
    { port: 3306, service: 'MySQL' },
    { port: 5432, service: 'PostgreSQL' },
    { port: 6379, service: 'Redis' },
    { port: 8080, service: 'HTTP Alt' },
    { port: 8081, service: 'HTTP Alt' },
    { port: 8112, service: 'StdOut' },
    { port: 8116, service: 'Windlass' },
    { port: 9000, service: 'Portainer' },
    { port: 5000, service: 'Docker Registry' },
  ];

  for (const host of hosts) {
    console.log('[scan-services] Scanning', host.ip, 'for services...');

    const services = [];
    const portList = COMMON_PORTS.map(p => p.port).join(',');
    const scanCommand = `nmap -p ${portList} -T4 --max-retries 1 ${host.ip}`;

    try {
      const { stdout } = await execAsync(scanCommand, { timeout: 30000 });
      const openPorts = parseOpenPorts(stdout);

      for (const port of openPorts) {
        const serviceInfo = COMMON_PORTS.find(p => p.port === port);
        if (serviceInfo) {
          services.push(serviceInfo);
          console.log('[scan-services] Found', serviceInfo.service, 'on', host.ip);
        }
      }

      // TODO: Update database with discovered services
      // For now just log them
      console.log('[scan-services] Completed scan for', host.ip, '- found', services.length, 'services');

    } catch (error) {
      console.error('[scan-services] Scan failed for', host.ip, ':', error);
    }
  }

  console.log('[scan-services] Background service scan complete for all hosts');
}

function parseOpenPorts(output: string): number[] {
  const ports: number[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // "22/tcp   open  ssh"
    const match = line.match(/^(\d+)\/tcp\s+open/);
    if (match) {
      ports.push(parseInt(match[1]));
    }
  }

  return ports;
}
