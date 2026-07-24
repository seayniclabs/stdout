/**
 * POST /app/api/riggins/command
 * Riggins AI command handler - executes infrastructure management tasks
 */

import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';
import { scanNetwork } from '../../../../lib/discovery/network-scanner';
import { getDb } from '../../../../lib/db';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const body = await request.json();
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const { command } = body;

  // Create SSE stream for real-time updates
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
      };

      try {
        // Parse command intent
        const normalizedCommand = command.toLowerCase().trim();

        if (
          normalizedCommand.includes('scan') ||
          normalizedCommand.includes('discover') ||
          normalizedCommand.includes('find')
        ) {
          await handleNetworkDiscovery(locals.user!.id, send);
        } else if (
          normalizedCommand.includes('monitor') ||
          normalizedCommand.includes('watch')
        ) {
          await handleCreateMonitors(locals.user!.id, send);
        } else if (
          normalizedCommand.includes('setup') ||
          normalizedCommand.includes('configure') ||
          normalizedCommand.includes('initialize')
        ) {
          // Full setup: discover + create monitors
          await handleNetworkDiscovery(locals.user!.id, send);
          await handleCreateMonitors(locals.user!.id, send);
        } else {
          send({
            type: 'message',
            role: 'assistant',
            content: `I'm not sure what you want me to do. I can help with:\n\n- **Scan network**: Discover all devices and services\n- **Create monitors**: Set up monitoring for discovered services\n- **Full setup**: Scan network and create monitors\n\nTry: "scan my network" or "set up monitoring for everything"`
          });
        }

        send({ type: 'complete' });
        controller.close();

      } catch (error: unknown) {
        console.error('[riggins] Command error:', error);
        send({
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
};

/**
 * Riggins scans the network and saves discovered devices
 */
async function handleNetworkDiscovery(userId: string, send: (data: any) => void) {
  send({
    type: 'message',
    role: 'assistant',
    content: "🔍 I'm scanning your network now. This will take about 10 seconds..."
  });

  const devices = await scanNetwork({
    arpScan: true,
    mdnsScan: true,
    ssdpScan: true,
    vendorLookup: true,
    timeout: 10
  });

  send({
    type: 'message',
    role: 'assistant',
    content: `✓ Network scan complete! I found **${devices.length} devices**:`
  });

  // Save to database
  const db = getDb();
  let newDevices = 0;
  let totalServices = 0;

  for (const device of devices) {
    const deviceId = nanoid();
    const now = Date.now();

    // Check if exists
    const existing = await db.get(sql`
      SELECT id FROM discovered_hosts
      WHERE ip_address = ${device.ip} OR (mac_address = ${device.mac} AND mac_address IS NOT NULL)
    `);

    if (!existing) {
      await db.run(sql`
        INSERT INTO discovered_hosts (
          id, ip_address, mac_address, hostname, device_type, vendor,
          os_guess, last_seen_at, first_seen_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        deviceId,
        device.ip,
        device.mac || null,
        device.hostname || null,
        device.deviceType || 'unknown',
        device.vendor || null,
        device.os || null,
        now,
        now,
        now
      ]);
      newDevices++;

      // Save services
      if (device.services) {
        for (const service of device.services) {
          const serviceId = nanoid();
          await db.run(sql`
            INSERT INTO discovered_services (
              id, host_id, name, port, protocol, type, description,
              discovered_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            serviceId,
            deviceId,
            service.name || 'Unknown Service',
            service.port || null,
            service.protocol || 'tcp',
            service.type || 'unknown',
            service.description || null,
            now,
            now
          ]);
          totalServices++;
        }
      }
    }
  }

  // Build device list
  const deviceList = devices.slice(0, 10).map(d =>
    `- **${d.hostname || d.ip}** (${d.ip})${d.vendor ? ` - ${d.vendor}` : ''}${d.services?.length ? ` - ${d.services.length} services` : ''}`
  ).join('\n');

  send({
    type: 'message',
    role: 'assistant',
    content: `${deviceList}\n${devices.length > 10 ? `\n...and ${devices.length - 10} more\n` : ''}\nSaved **${newDevices} new devices** and **${totalServices} services** to the database.`
  });
}

/**
 * Riggins creates monitors for discovered services
 */
async function handleCreateMonitors(userId: string, send: (data: any) => void) {
  send({
    type: 'message',
    role: 'assistant',
    content: "⚙️ Creating monitors for your services..."
  });

  const db = getDb();

  // Get all stacks
  let stacks = await db.all(sql`
    SELECT id, name FROM stacks WHERE user_id = ${userId}
  `) as Array<{ id: string; name: string }>;

  // Create default stack if none exist
  if (stacks.length === 0) {
    const stackId = nanoid();
    const now = Date.now();
    await db.run(sql`
      INSERT INTO stacks (id, user_id, name, description, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      stackId,
      userId,
      'Infrastructure',
      'Auto-discovered infrastructure and services',
      JSON.stringify(['auto-discovered']),
      now,
      now
    ]);
    stacks = [{ id: stackId, name: 'Infrastructure' }];
  }

  const stack = stacks[0];

  // Get discovered services
  const services = await db.all(sql`
    SELECT
      ds.id, ds.name, ds.port, ds.protocol, ds.type,
      dh.ip_address, dh.hostname
    FROM discovered_services ds
    JOIN discovered_hosts dh ON ds.host_id = dh.id
    WHERE ds.port IS NOT NULL
  `) as Array<{
    id: string;
    name: string;
    port: number;
    protocol: string;
    type: string;
    ip_address: string;
    hostname: string | null;
  }>;

  let monitorsCreated = 0;

  for (const service of services) {
    // Check if monitor already exists
    const existing = await db.get(sql`
      SELECT id FROM monitors
      WHERE target LIKE ${'%' + service.ip_address + '%'}
      AND user_id = ${userId}
    `);

    if (existing) continue;

    // Create monitor
    const monitorId = nanoid();
    const now = Date.now();

    let monitorType = 'tcp';
    let target = `${service.ip_address}:${service.port}`;

    // Use HTTP monitor for web services
    if (service.port === 80 || service.port === 443 || service.port === 8080 || service.type === 'http') {
      monitorType = 'http';
      const protocol = service.port === 443 ? 'https' : 'http';
      target = `${protocol}://${service.ip_address}:${service.port}`;
    }

    const monitorName = `${service.hostname || service.ip_address}:${service.port} (${service.name})`;

    await db.run(sql`
      INSERT INTO monitors (
        id, user_id, stack_id, name, type, target,
        interval_seconds, paused, current_status, consecutive_failures,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'unknown', 0, ?, ?)
    `, [
      monitorId,
      userId,
      stack.id,
      monitorName,
      monitorType,
      target,
      300, // 5 minute interval
      now,
      now
    ]);

    monitorsCreated++;
  }

  send({
    type: 'message',
    role: 'assistant',
    content: `✓ Created **${monitorsCreated} new monitors** in the **${stack.name}** stack.\n\nAll services are now being monitored. You can see them in the Infrastructure tab.`
  });
}
