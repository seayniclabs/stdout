import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getSqlite } from '../../../../lib/db/index.ts';
import { validateNmapData } from '../../../../lib/discovery/nmap-parser';
import { emit } from '../../../../lib/events';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

/**
 * POST /app/api/discovery/ingest
 *
 * Formalized endpoint for ingesting Nmap discovery XML/JSON payloads.
 * Validates, sanitizes, and registers discovered hosts and services.
 * Integrates into the entity graph topology and triggers monitor auto-creation.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  // CSRF check - special handling for text payload
  const csrfFromHeader = request.headers.get('x-csrf-token');
  // For ingest, we might get CSRF from header only (since body is XML/JSON payload, not form data)
  if (!validateCsrf(csrfFromHeader, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const contentType = request.headers.get('content-type') || '';
  let payload = '';

  try {
    payload = await request.text();
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: `Failed to read request body: ${error instanceof Error ? error.message : String(error)}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate the data first
  const validation = validateNmapData(payload, contentType);
  if (!validation.valid) {
    return new Response(JSON.stringify({
      error: 'Schema validation failed',
      errors: validation.errors,
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getSqlite();
  const userId = locals.user.id;
  const now = new Date().toISOString();

  let hostsIngested = 0;
  let servicesIngested = 0;
  let entitiesCreatedOrUpdated = 0;

  // Use a transaction to ensure atomic ingestion of hosts, services, and entities
  db.transaction(() => {
    for (const host of validation.hosts) {
      // 1. Ingest host into discovered_hosts
      let hostId = '';
      const existingHost = db.prepare(`
        SELECT id FROM discovered_hosts
        WHERE ip_address = ?
        LIMIT 1
      `).get(host.ip) as { id: string } | undefined;

      if (existingHost) {
        hostId = existingHost.id;
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
          host.hostname || null,
          host.mac || null,
          host.vendor || null,
          'host',
          now,
          now,
          hostId
        );
      } else {
        hostId = 'host_' + nanoid();
        db.prepare(`
          INSERT INTO discovered_hosts (
            id, ip_address, hostname, mac_address, vendor,
            device_type, discovered_at, last_seen, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          hostId,
          host.ip,
          host.hostname || null,
          host.mac || null,
          host.vendor || null,
          'host',
          now,
          now,
          now,
          now
        );
        hostsIngested++;
        
        // Emit host.discovered event for new hosts so auto-wire can create monitors
        emit({
          type: 'host.discovered',
          userId,
          hostId,
          ip: host.ip,
          hostname: host.hostname || null,
          stackId: null
        });
      }

      // 2. Ingest host into entities (Device)
      const existingDeviceEntity = db.prepare(`
        SELECT id FROM entities
        WHERE type = 'device' AND properties->>'$.ip' = ?
        LIMIT 1
      `).get(host.ip) as { id: string } | undefined;

      const deviceProperties = {
        ip: host.ip,
        mac: host.mac || null,
        hostname: host.hostname || null,
        vendor: host.vendor || null,
        deviceType: 'host',
        confidence: 'high',
        metadata: {
          friendlyName: host.hostname || host.ip,
          nmapIngested: true,
        },
        signals: {
          nmapPorts: host.ports.length,
        },
      };

      let deviceEntityId = '';
      if (existingDeviceEntity) {
        deviceEntityId = existingDeviceEntity.id;
        db.prepare(`
          UPDATE entities
          SET name = ?,
              properties = ?,
              last_seen = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          host.hostname || host.ip,
          JSON.stringify(deviceProperties),
          now,
          now,
          deviceEntityId
        );
      } else {
        deviceEntityId = 'ent_' + nanoid();
        db.prepare(`
          INSERT INTO entities (
            id, type, name, properties,
            discovered_at, last_seen, created_at, updated_at
          ) VALUES (?, 'device', ?, ?, ?, ?, ?, ?)
        `).run(
          deviceEntityId,
          host.hostname || host.ip,
          JSON.stringify(deviceProperties),
          now,
          now,
          now,
          now
        );
        entitiesCreatedOrUpdated++;
      }

      // 3. Ingest ports/services
      for (const service of host.ports) {
        // A. discovered_services
        const existingService = db.prepare(`
          SELECT id FROM discovered_services
          WHERE host_id = ? AND port = ? AND protocol = ?
          LIMIT 1
        `).get(hostId, service.port, service.protocol) as { id: string } | undefined;

        if (existingService) {
          db.prepare(`
            UPDATE discovered_services
            SET service_name = ?,
                service_version = ?,
                last_seen = ?,
                updated_at = ?
            WHERE id = ?
          `).run(
            service.serviceName || null,
            service.serviceVersion || null,
            now,
            now,
            existingService.id
          );
        } else {
          db.prepare(`
            INSERT INTO discovered_services (
              id, host_id, port, protocol,
              service_name, service_version, last_seen, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            'svc_' + nanoid(),
            hostId,
            service.port,
            service.protocol,
            service.serviceName || null,
            service.serviceVersion || null,
            now,
            now,
            now
          );
          servicesIngested++;
        }

        // B. entities (Service entity type)
        const existingServiceEntity = db.prepare(`
          SELECT id FROM entities
          WHERE type = 'service' AND properties->>'$.ip' = ? AND properties->>'$.port' = ?
          LIMIT 1
        `).get(host.ip, service.port) as { id: string } | undefined;

        const serviceProperties = {
          ip: host.ip,
          port: service.port,
          protocol: service.protocol,
          serviceName: service.serviceName || null,
          serviceVersion: service.serviceVersion || null,
        };

        const serviceEntityName = service.serviceName 
          ? `${service.serviceName} (${service.port}/${service.protocol})`
          : `port ${service.port}/${service.protocol}`;

        let serviceEntityId = '';
        if (existingServiceEntity) {
          serviceEntityId = existingServiceEntity.id;
          db.prepare(`
            UPDATE entities
            SET name = ?,
                properties = ?,
                last_seen = ?,
                updated_at = ?
            WHERE id = ?
          `).run(
            serviceEntityName,
            JSON.stringify(serviceProperties),
            now,
            now,
            serviceEntityId
          );
        } else {
          serviceEntityId = 'ent_' + nanoid();
          db.prepare(`
            INSERT INTO entities (
              id, type, name, properties,
              discovered_at, last_seen, created_at, updated_at
            ) VALUES (?, 'service', ?, ?, ?, ?, ?, ?)
          `).run(
            serviceEntityId,
            serviceEntityName,
            JSON.stringify(serviceProperties),
            now,
            now,
            now,
            now
          );
          entitiesCreatedOrUpdated++;
        }

        // C. entity_relationships (runs_on relationship from Service to Device)
        const existingRelationship = db.prepare(`
          SELECT id FROM entity_relationships
          WHERE source_id = ? AND target_id = ? AND type = 'runs_on'
          LIMIT 1
        `).get(serviceEntityId, deviceEntityId) as { id: string } | undefined;

        if (existingRelationship) {
          db.prepare(`
            UPDATE entity_relationships
            SET metadata = ?,
                updated_at = ?
            WHERE id = ?
          `).run(
            JSON.stringify({ port: service.port, protocol: service.protocol }),
            now,
            existingRelationship.id
          );
        } else {
          db.prepare(`
            INSERT INTO entity_relationships (
              id, source_id, target_id, type, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, 'runs_on', ?, ?, ?)
          `).run(
            'rel_' + nanoid(),
            serviceEntityId,
            deviceEntityId,
            JSON.stringify({ port: service.port, protocol: service.protocol }),
            now,
            now
          );
        }
      }
    }
  })();

  // 4. Sync and start monitors
  let monitorsCreated = 0;
  try {
    const { syncHostMonitors } = await import('../../../../lib/observatory/sync-host-monitors');
    const result = syncHostMonitors(db, userId);
    monitorsCreated = result.created;

    if (result.created > 0) {
      const { startMonitor } = await import('../../../../lib/hud');
      const newMonitors = db.prepare(`
        SELECT id FROM monitors
        WHERE created_at >= ?
      `).all(now) as Array<{ id: string }>;

      for (const monitor of newMonitors) {
        try {
          startMonitor(userId, monitor.id);
        } catch (error) {
          // Ignore starting failures
        }
      }
    }
  } catch (error) {
    console.error('[discovery/ingest] Monitor sync failed:', error);
  }

  // Emit scanner.complete event for overall discovery pipeline integration
  try {
    emit({
      type: 'scanner.complete',
      userId,
      hostsFound: validation.hosts.length,
      subnet: 'Nmap Ingestion'
    });
  } catch (error) {
    console.error('[discovery/ingest] Failed to emit scanner.complete:', error);
  }

  return new Response(JSON.stringify({
    success: true,
    hostsIngested,
    servicesIngested,
    entitiesCreatedOrUpdated,
    monitorsCreated,
    message: `Ingestion successful. Processed ${validation.hosts.length} hosts, registered ${hostsIngested} new hosts, ${servicesIngested} new services, and created ${monitorsCreated} monitors.`
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
