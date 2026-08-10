/**
 * Command Handlers - Direct execution of parsed commands
 *
 * Fast path for explicit commands - no LLM needed.
 */

import { scanNetwork } from '../discovery/network-scanner';
import { getDb, schema } from '../db';
import { sql, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
}

/**
 * Execute network scan
 */
export async function executeNetworkScan(
  userId: string,
  createMonitors: boolean = false
): Promise<CommandResult> {
  try {
    // Run network discovery
    const devices = await scanNetwork({
      arpScan: true,
      mdnsScan: true,
      ssdpScan: true,
      vendorLookup: true,
      timeout: 10,
    });

    // Save discovered devices
    const db = getDb();
    let savedDevices = 0;
    let savedServices = 0;

    for (const device of devices) {
      const deviceId = nanoid();
      const now = Date.now();

      // Check if device already exists
      const existing = await db.get(sql`
        SELECT id FROM discovered_hosts
        WHERE ip_address = ${device.ip} OR (mac_address = ${device.mac} AND mac_address IS NOT NULL)
      `);

      if (!existing) {
        await db.insert(schema.discoveredHosts).values({
          id: deviceId,
          userId,
          ipAddress: device.ip,
          macAddress: device.mac || null,
          hostname: device.hostname || null,
          vendor: device.vendor || null,
          lastSeen: new Date(now),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        savedDevices++;

        // Save services
        if (device.services) {
          for (const service of device.services) {
            const serviceId = nanoid();
            await db.insert(schema.discoveredServices).values({
              id: serviceId,
              hostId: deviceId,
              userId,
              port: service.port || 0,
              protocol: service.protocol || 'tcp',
              serviceName: service.name || 'Unknown Service',
              lastSeen: new Date(now),
              createdAt: new Date(now),
              updatedAt: new Date(now),
            });
            savedServices++;
          }
        }
      }
    }

    let message = `✅ **Network scan complete!**\n\nFound **${devices.length} devices** on your network.\n\nSaved **${savedDevices} new devices** and **${savedServices} services** to the database.`;

    // Auto-create monitors if requested
    if (createMonitors && savedServices > 0) {
      const monitorsResult = await executeCreateMonitors(userId);
      message += `\n\n${monitorsResult.message}`;
    }

    message += `\n\n📊 View them in the **Infrastructure** tab.`;

    return {
      success: true,
      message,
      data: {
        totalDevices: devices.length,
        newDevices: savedDevices,
        services: savedServices,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ Network scan failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create monitors for discovered services
 */
export async function executeCreateMonitors(userId: string): Promise<CommandResult> {
  try {
    const db = getDb();

    // Get or create default stack
    let stacks = await db.all(sql`
      SELECT id, name FROM stacks
    `) as Array<{ id: string; name: string }>;

    if (stacks.length === 0) {
      const stackId = nanoid();
      const now = Date.now();
      await db.insert(schema.stacks).values({
        id: stackId,
        name: 'Infrastructure',
        description: 'Auto-discovered infrastructure and services',
        tags: JSON.stringify(['auto-discovered']),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      });
      stacks = [{ id: stackId, name: 'Infrastructure' }];
    }

    const stack = stacks[0];

    // Get discovered services
    const services = await db.all(sql`
      SELECT
        ds.id, ds.service_name as name, ds.port, ds.protocol,
        dh.ip_address, dh.hostname
      FROM discovered_services ds
      JOIN discovered_hosts dh ON ds.host_id = dh.id
      WHERE ds.port IS NOT NULL
    `) as Array<{
      id: string;
      name: string;
      port: number;
      protocol: string;
      ip_address: string;
      hostname: string | null;
    }>;

    let monitorsCreated = 0;

    for (const service of services) {
      // Check if monitor already exists
      const existing = await db.get(sql`
        SELECT id FROM monitors
        WHERE target LIKE ${'%' + service.ip_address + '%'}
      `);

      if (existing) continue;

      // Create monitor
      const monitorId = nanoid();
      const now = Date.now();

      let monitorType = 'tcp';
      let target = `${service.ip_address}:${service.port}`;

      // Use HTTP monitor for common web service ports
      if (service.port === 80 || service.port === 443 || service.port === 8080 || service.port === 8443) {
        monitorType = 'http';
        const protocol = service.port === 443 || service.port === 8443 ? 'https' : 'http';
        target = `${protocol}://${service.ip_address}:${service.port}`;
      }

      const monitorName = `${service.hostname || service.ip_address}:${service.port} (${service.name})`;

      await db.insert(schema.monitors).values({
        id: monitorId,
        userId,
        stackId: stack.id,
        name: monitorName,
        type: monitorType,
        target,
        intervalSeconds: 300, // 5 minutes
        paused: false,
        currentStatus: 'unknown',
        consecutiveFailures: 0,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      });

      monitorsCreated++;
    }

    return {
      success: true,
      message: `✅ Created **${monitorsCreated} monitors** in the **${stack.name}** stack.\n\nAll services are now being monitored!`,
      data: {
        monitorsCreated,
        stackName: stack.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ Monitor creation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create a new stack
 */
export async function executeCreateStack(
  userId: string,
  name: string,
  description?: string
): Promise<CommandResult> {
  try {
    const db = getDb();
    const stackId = nanoid();
    const now = Date.now();

    await db.insert(schema.stacks).values({
      id: stackId,
      userId,
      name,
      description: description || `Infrastructure stack: ${name}`,
      tags: JSON.stringify([]),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });

    return {
      success: true,
      message: `✅ Created stack **${name}**!\n\nYou can now add monitors and services to it.`,
      data: {
        stackId,
        name,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ Stack creation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
