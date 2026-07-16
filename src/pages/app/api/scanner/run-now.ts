import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ locals, request }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getDb();
    const schedule = db.select().from(schema.scannerSchedule)
      .where(eq(schema.scannerSchedule.userId, session.id)).get();

    if (schedule && !schedule.enabled) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Scanner is disabled. Enable it first in the scanner settings.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('[run-now] Triggering scanner...');

    // Import and run the scanner logic directly instead of HTTP fetch
    // This avoids localhost/port resolution issues in containers
    const { scanNetwork } = await import('../../../../lib/discovery/network-scanner');
    const { getSqlite } = await import('../../../../lib/db');
    const { nanoid } = await import('nanoid');

    // Run scan in background (don't await)
    (async () => {
      try {
        const devices = await scanNetwork({
          arpScan: true,
          mdnsScan: true,
          ssdpScan: true,
          vendorLookup: true,
          timeout: 10,
        });

        console.log(`[run-now] Scanner found ${devices.length} devices`);

        const db = getSqlite();
        const now = new Date().toISOString();

        // Create entities in entity graph
        for (const device of devices) {
          const properties = {
            ip: device.ip,
            mac: device.mac,
            hostname: device.hostname,
            vendor: device.vendor,
            deviceType: device.deviceType,
            confidence: device.confidence,
            metadata: device.metadata,
            signals: {
              mdnsServices: device.signals.mdns?.length || 0,
              ssdpDevices: device.signals.ssdp?.length || 0,
              hasVendor: !!device.signals.vendor,
            },
          };

          // Check if entity already exists
          const existingEntity = db.prepare(`
            SELECT id FROM entities
            WHERE user_id = ? AND type = 'device' AND properties->>'$.ip' = ?
            LIMIT 1
          `).get(session.id, device.ip) as { id: string } | undefined;

          if (existingEntity) {
            // Update existing
            db.prepare(`
              UPDATE entities
              SET name = ?, properties = ?, last_seen = ?, updated_at = ?
              WHERE id = ?
            `).run(
              device.metadata.friendlyName || device.hostname || device.ip,
              JSON.stringify(properties),
              now,
              now,
              existingEntity.id
            );
          } else {
            // Create new
            db.prepare(`
              INSERT INTO entities (
                id, user_id, type, name, properties,
                discovered_at, last_seen, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              nanoid(),
              session.id,
              'device',
              device.metadata.friendlyName || device.hostname || device.ip,
              JSON.stringify(properties),
              now,
              now,
              now,
              now
            );
          }

          // Also populate discovered_hosts for backward compatibility
          const existingHost = db.prepare(`
            SELECT id FROM discovered_hosts
            WHERE user_id = ? AND ip_address = ?
            LIMIT 1
          `).get(session.id, device.ip) as { id: string } | undefined;

          if (existingHost) {
            db.prepare(`
              UPDATE discovered_hosts
              SET hostname = ?, mac_address = ?, vendor = ?, device_type = ?, last_seen = ?, updated_at = ?
              WHERE id = ?
            `).run(
              device.hostname || null,
              device.mac || null,
              device.vendor || null,
              device.deviceType,
              now,
              now,
              existingHost.id
            );
          } else {
            db.prepare(`
              INSERT INTO discovered_hosts (
                id, user_id, ip_address, hostname, mac_address, vendor,
                device_type, discovered_at, last_seen, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              nanoid(),
              session.id,
              device.ip,
              device.hostname || null,
              device.mac || null,
              device.vendor || null,
              device.deviceType,
              now,
              now,
              now,
              now
            );
          }
        }

        // Sync host monitors
        const { syncHostMonitors } = await import('../../../../lib/observatory/sync-host-monitors');
        const result = syncHostMonitors(db, session.id);

        if (result.created > 0) {
          const { startMonitor } = await import('../../../../lib/hud');
          const newMonitors = db.prepare(`
            SELECT id FROM monitors
            WHERE user_id = ? AND created_at >= ?
          `).all(session.id, now) as Array<{ id: string }>;

          for (const monitor of newMonitors) {
            try {
              startMonitor(session.id, monitor.id);
            } catch (err) {
              console.error(`[run-now] Failed to start monitor ${monitor.id}:`, err);
            }
          }
        }

        console.log(`[run-now] Scan complete: ${devices.length} devices, ${result.created} new monitors`);
      } catch (err) {
        console.error('[run-now] Background scan failed:', err);
      }
    })();

    return new Response(JSON.stringify({
      success: true,
      message: 'Scanner started. Results will appear in the HUD shortly.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[run-now] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Failed to start scanner'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
