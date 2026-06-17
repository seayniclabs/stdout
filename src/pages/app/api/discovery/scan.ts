import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getSqlite } from '../../../../lib/db';
import { scanNetwork } from '../../../../lib/discovery/network-scanner';

/**
 * Comprehensive Network Discovery API
 * Performs Fing-level network scan using ARP, mDNS, SSDP, and vendor lookups
 */

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_monitors');
  if (rbacBlock) return rbacBlock;

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // No body or invalid JSON, use defaults
  }

  const {
    arpScan = true,
    mdnsScan = true,
    ssdpScan = true,
    vendorLookup = true,
    timeout = 10,
    createEntities = true,
    createMonitors = true,
  } = body;

  console.log('[discovery/scan] Starting comprehensive network discovery...');

  try {
    // Perform comprehensive scan
    const devices = await scanNetwork({
      arpScan,
      mdnsScan,
      ssdpScan,
      vendorLookup,
      timeout,
    });

    console.log(`[discovery/scan] Found ${devices.length} devices`);

    const db = getSqlite();
    const now = new Date().toISOString();

    // Store discovered hosts in database
    for (const device of devices) {
      // Check if host already exists
      const existing = db.prepare(`
        SELECT id FROM discovered_hosts
        WHERE user_id = ? AND ip_address = ?
        LIMIT 1
      `).get(locals.user.id, device.ip) as { id: string } | undefined;

      if (existing) {
        // Update existing host
        db.prepare(`
          UPDATE discovered_hosts
          SET hostname = ?,
              mac_address = ?,
              vendor = ?,
              device_type = ?,
              last_seen = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          device.hostname || null,
          device.mac || null,
          device.vendor || null,
          device.deviceType,
          now,
          now,
          existing.id
        );
      } else {
        // Insert new host
        db.prepare(`
          INSERT INTO discovered_hosts (
            id, user_id, ip_address, hostname, mac_address, vendor,
            device_type, discovered_at, last_seen, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          nanoid(),
          locals.user.id,
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

    // Create entities in entity graph if requested
    let entitiesCreated = 0;
    if (createEntities) {
      for (const device of devices) {
        // Check if entity already exists
        const existingEntity = db.prepare(`
          SELECT id FROM entities
          WHERE user_id = ? AND type = 'device' AND properties->>'$.ip' = ?
          LIMIT 1
        `).get(locals.user.id, device.ip) as { id: string } | undefined;

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

        if (existingEntity) {
          // Update existing entity
          db.prepare(`
            UPDATE entities
            SET name = ?,
                properties = ?,
                last_seen = ?,
                updated_at = ?
            WHERE id = ?
          `).run(
            device.metadata.friendlyName || device.hostname || device.ip,
            JSON.stringify(properties),
            now,
            now,
            existingEntity.id
          );
        } else {
          // Create new entity
          db.prepare(`
            INSERT INTO entities (
              id, user_id, type, name, properties,
              discovered_at, last_seen, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            nanoid(),
            locals.user.id,
            'device',
            device.metadata.friendlyName || device.hostname || device.ip,
            JSON.stringify(properties),
            now,
            now,
            now,
            now
          );
          entitiesCreated++;
        }
      }
    }

    // Create monitors if requested
    let monitorsCreated = 0;
    if (createMonitors) {
      const { syncHostMonitors } = await import('../../../../lib/observatory/sync-host-monitors');
      const result = syncHostMonitors(db, locals.user.id);
      monitorsCreated = result.created;

      // Start newly created monitors
      if (result.created > 0) {
        const { startMonitor } = await import('../../../../lib/hud');
        const newMonitors = db.prepare(`
          SELECT id FROM monitors
          WHERE user_id = ? AND created_at >= ?
        `).all(locals.user.id, now) as Array<{ id: string }>;

        for (const monitor of newMonitors) {
          try {
            startMonitor(locals.user.id, monitor.id);
          } catch (err) {
            // Continue even if one fails
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      devicesFound: devices.length,
      entitiesCreated,
      monitorsCreated,
      deviceBreakdown: {
        high_confidence: devices.filter((d) => d.confidence === 'high').length,
        medium_confidence: devices.filter((d) => d.confidence === 'medium').length,
        low_confidence: devices.filter((d) => d.confidence === 'low').length,
      },
      devices: devices.map((d) => ({
        ip: d.ip,
        name: d.metadata.friendlyName || d.hostname || d.ip,
        type: d.deviceType,
        vendor: d.vendor,
        confidence: d.confidence,
      })),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[discovery/scan] Scan failed:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
