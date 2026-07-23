import type { APIRoute } from 'astro';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb, schema } from '../../../../lib/db';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../../../../lib/rbac';

const execAsync = promisify(exec);

/**
 * Background service scanner
 *
 * Runs deep nmap port scans on discovered hosts to detect services.
 * This is async and silent - runs after the wizard completes.
 *
 * Called automatically after setup OR manually from infrastructure page.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  const body = await request.json();
  const { hosts } = body;

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const hostList = hosts || []; // Array of {ip, hostname?}

  console.log('[scan-services] Starting background service scan for', hostList.length, 'hosts');

  // Run in background - don't wait for completion
  const userId = locals.workspace?.ownerId || locals.user.id;
  scanServicesInBackground(hostList, userId).catch(err => {
    console.error('[scan-services] Background scan failed:', err);
  });

  return new Response(
    JSON.stringify({
      status: 'started',
      hosts: hostList.length,
      message: 'Service scan started in background'
    }),
    {
      status: 202, // Accepted
      headers: { 'Content-Type': 'application/json' }
    }
  );
};

async function scanServicesInBackground(hosts: Array<{ ip: string; hostname?: string }>, userId: string) {
  const db = getDb();
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

      // Upsert host record
      const hostRecord = db
        .select()
        .from(discoveredHosts)
        .where(eq(discoveredHosts.ipAddress, host.ip))
        .get();

      let hostId: string;
      if (!hostRecord) {
        const now = new Date();
        hostId = 'host_' + nanoid();
        db.insert(discoveredHosts).values({
          id: hostId,
          userId,
          ipAddress: host.ip,
          hostname: host.hostname || null,
          macAddress: null,
          vendor: null,
          lastSeen: now,
          createdAt: now,
          updatedAt: now,
        }).run();
        console.log('[scan-services] Created host record:', hostId);
      } else {
        hostId = hostRecord.id;
        // Update lastSeen
        db.update(discoveredHosts)
          .set({ lastSeen: new Date(), updatedAt: new Date() })
          .where(eq(discoveredHosts.id, hostId))
          .run();
      }

      // Upsert service records
      for (const serviceInfo of services) {
        const existing = db
          .select()
          .from(discoveredServices)
          .where(
            and(
              eq(discoveredServices.hostId, hostId),
              eq(discoveredServices.port, serviceInfo.port)
            )
          )
          .get();

        if (existing) {
          // Update lastSeen
          db.update(discoveredServices)
            .set({ lastSeen: new Date(), updatedAt: new Date() })
            .where(eq(discoveredServices.id, existing.id))
            .run();
        } else {
          // Insert new service
          const now = new Date();
          db.insert(discoveredServices).values({
            id: 'svc_' + nanoid(),
            hostId: hostId,
            userId,
            port: serviceInfo.port,
            protocol: 'tcp',
            serviceName: serviceInfo.service,
            serviceVersion: null,
            lastSeen: now,
            createdAt: now,
            updatedAt: now,
          }).run();
          console.log('[scan-services] Added service:', serviceInfo.service, 'on port', serviceInfo.port);
        }
      }

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
