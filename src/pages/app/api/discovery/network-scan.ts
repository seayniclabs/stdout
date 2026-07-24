/**
 * POST /app/api/discovery/network-scan
 * Comprehensive network discovery using ARP, mDNS, SSDP
 */

import type { APIRoute } from 'astro';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';
import { scanNetwork } from '../../../../lib/discovery/network-scanner';
import { getDb } from '../../../../lib/db';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  // CSRF check
  let body: any = {};
  try { body = await request.json(); } catch { /* Optional body */ }
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
      };

      try {
        send({ type: 'log', level: 'info', message: 'Starting comprehensive network discovery...' });
        send({ type: 'progress', percent: 5 });

        // Run comprehensive network scan
        send({ type: 'log', level: 'info', message: 'Scanning network (ARP + mDNS + SSDP)...' });
        const discoveredDevices = await scanNetwork({
          arpScan: true,
          mdnsScan: true,
          ssdpScan: true,
          vendorLookup: true,
          timeout: 10
        });

        send({ type: 'progress', percent: 50 });
        send({ type: 'log', level: 'success', message: `Found ${discoveredDevices.length} devices` });

        // Save to database
        const db = getDb();
        let savedDevices = 0;
        let savedServices = 0;

        send({ type: 'log', level: 'info', message: 'Saving discovered devices...' });

        for (const device of discoveredDevices) {
          try {
            const deviceId = nanoid();
            const now = Date.now();

            // Check if device already exists
            const existing = await db.get(sql`
              SELECT id FROM discovered_hosts
              WHERE ip_address = ${device.ip} OR mac_address = ${device.mac}
            `);

            if (existing) {
              // Update existing device
              await db.run(sql`
                UPDATE discovered_hosts
                SET hostname = ${device.hostname || null},
                    device_type = ${device.deviceType || 'unknown'},
                    vendor = ${device.vendor || null},
                    os_guess = ${device.os || null},
                    last_seen_at = ${now}
                WHERE id = ${existing.id}
              `);
            } else {
              // Insert new device
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
              savedDevices++;
            }

            // Save services
            if (device.services && device.services.length > 0) {
              for (const service of device.services) {
                const serviceId = nanoid();
                await db.run(sql`
                  INSERT INTO discovered_services (
                    id, host_id, name, port, protocol, type, description,
                    discovered_at, created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                  serviceId,
                  existing?.id || deviceId,
                  service.name || 'Unknown Service',
                  service.port || null,
                  service.protocol || 'tcp',
                  service.type || 'unknown',
                  service.description || null,
                  now,
                  now
                ]);
                savedServices++;
              }
            }
          } catch (error) {
            console.error('[network-scan] Failed to save device:', device.ip, error);
            send({ type: 'log', level: 'warning', message: `Failed to save ${device.ip}: ${error instanceof Error ? error.message : String(error)}` });
          }
        }

        send({ type: 'progress', percent: 90 });
        send({ type: 'log', level: 'success', message: `Saved ${savedDevices} new devices and ${savedServices} services` });

        send({ type: 'progress', percent: 100 });
        send({ type: 'log', level: 'success', message: 'Network discovery complete!' });
        send({
          type: 'complete',
          devices: discoveredDevices.length,
          saved: savedDevices,
          services: savedServices
        });

        controller.close();

      } catch (error: unknown) {
        console.error('[network-scan] Scan error:', error);
        send({ type: 'log', level: 'error', message: `Scan failed: ${error instanceof Error ? error.message : String(error)}` });
        send({ type: 'progress', percent: 100 });
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
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
