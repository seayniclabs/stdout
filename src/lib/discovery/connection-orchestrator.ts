/**
 * Connection Orchestrator
 *
 * Runs after initial discovery to attempt auto-connection to discovered devices
 * Home Assistant-style: discover → detect type → attempt connection → update status
 */

import { getDb } from '../db';
import { discoveredHosts, integrationConfigs, ignoredDiscoveries } from '../db/monitoring-schema';
import { eq, sql } from 'drizzle-orm';
import { detectIntegrationType, generateUniqueId } from './integration-detector';
import { attemptConnection } from './connection-handler';

/**
 * Process newly discovered hosts - detect integration types and attempt connections
 */
export async function processDiscoveredHosts(): Promise<void> {
  const db = getDb();

  try {
    // Get all ignored device IDs
    const ignored = await db.select({ uniqueId: ignoredDiscoveries.uniqueId })
      .from(ignoredDiscoveries)
      .all();
    const ignoredSet = new Set(ignored.map(i => i.uniqueId));

    // Get all discovered hosts that haven't been processed yet
    const hosts = await db
      .select()
      .from(discoveredHosts)
      .where(eq(discoveredHosts.connectionStatus, 'discovered'))
      .all();

    console.log(`[connection-orchestrator] Processing ${hosts.length} discovered hosts`);

    for (const host of hosts) {
      // Skip if in ignore list
      const uniqueId = generateUniqueId(host.ipAddress, host.macAddress || undefined);
      if (ignoredSet.has(uniqueId)) {
        console.log(`[connection-orchestrator] Skipping ignored device: ${host.ipAddress}`);
        await db
          .update(discoveredHosts)
          .set({
            connectionStatus: 'ignored',
            ignoredAt: Date.now(),
            updatedAt: Date.now(),
          })
          .where(eq(discoveredHosts.id, host.id))
          .run();
        continue;
      }

      // Parse open ports
      const openPorts: number[] = host.openPorts ? JSON.parse(host.openPorts) : [];

      if (openPorts.length === 0) {
        console.log(`[connection-orchestrator] No open ports for ${host.ipAddress}, skipping`);
        continue;
      }

      // Detect integration type
      const integration = detectIntegrationType(openPorts);

      if (!integration) {
        console.log(`[connection-orchestrator] No integration detected for ${host.ipAddress} (ports: ${openPorts.join(', ')})`);
        continue;
      }

      console.log(`[connection-orchestrator] Detected ${integration.name} on ${host.ipAddress}:${integration.ports[0]}`);

      // Update status to "connecting"
      await db
        .update(discoveredHosts)
        .set({
          connectionStatus: 'connecting',
          connectionAttemptedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(eq(discoveredHosts.id, host.id))
        .run();

      // Attempt connection
      const result = await attemptConnection(host.ipAddress, integration);

      // Update host based on connection result
      if (result.success) {
        console.log(`[connection-orchestrator] ✓ Connected to ${integration.name} at ${host.ipAddress}`);

        // Update host status
        await db
          .update(discoveredHosts)
          .set({
            connectionStatus: 'connected',
            connectionError: null,
            credentials: result.config ? JSON.stringify(result.config) : null,
            updatedAt: Date.now(),
          })
          .where(eq(discoveredHosts.id, host.id))
          .run();

        // Create integration config
        if (result.config) {
          const integrationId = `int_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          await db
            .insert(integrationConfigs)
            .values({
              id: integrationId,
              hostId: host.id,
              integrationType: integration.type,
              config: JSON.stringify(result.config),
              status: 'connected',
              lastConnectionAttempt: Date.now(),
              errorMessage: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
            .run();
        }
      } else if (result.needsConfig) {
        console.log(`[connection-orchestrator] ⚠ ${integration.name} at ${host.ipAddress} needs configuration`);

        await db
          .update(discoveredHosts)
          .set({
            connectionStatus: 'needs_config',
            connectionError: result.error || 'Configuration required',
            credentials: result.config ? JSON.stringify(result.config) : null,
            updatedAt: Date.now(),
          })
          .where(eq(discoveredHosts.id, host.id))
          .run();
      } else {
        console.log(`[connection-orchestrator] ✗ Connection failed to ${integration.name} at ${host.ipAddress}: ${result.error}`);

        await db
          .update(discoveredHosts)
          .set({
            connectionStatus: 'failed',
            connectionError: result.error || 'Connection failed',
            updatedAt: Date.now(),
          })
          .where(eq(discoveredHosts.id, host.id))
          .run();
      }
    }

    console.log(`[connection-orchestrator] Finished processing ${hosts.length} hosts`);
  } catch (error) {
    console.error('[connection-orchestrator] Error processing hosts:', error);
  }
}

/**
 * Test connection with user-provided credentials
 */
export async function testConnection(
  hostId: string,
  integrationType: string,
  config: Record<string, any>,
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  try {
    const host = await db
      .select()
      .from(discoveredHosts)
      .where(eq(discoveredHosts.id, hostId))
      .get();

    if (!host) {
      return { success: false, error: 'Host not found' };
    }

    // For now, just update the credentials
    // TODO: Implement actual connection test logic per integration type
    await db
      .update(discoveredHosts)
      .set({
        connectionStatus: 'connected',
        credentials: JSON.stringify(config),
        connectionError: null,
        updatedAt: Date.now(),
      })
      .where(eq(discoveredHosts.id, hostId))
      .run();

    // Update or create integration config
    const existingIntegration = await db
      .select()
      .from(integrationConfigs)
      .where(eq(integrationConfigs.hostId, hostId))
      .get();

    if (existingIntegration) {
      await db
        .update(integrationConfigs)
        .set({
          config: JSON.stringify(config),
          status: 'connected',
          lastConnectionAttempt: Date.now(),
          errorMessage: null,
          updatedAt: Date.now(),
        })
        .where(eq(integrationConfigs.id, existingIntegration.id))
        .run();
    } else {
      const integrationId = `int_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await db
        .insert(integrationConfigs)
        .values({
          id: integrationId,
          hostId,
          integrationType,
          config: JSON.stringify(config),
          status: 'connected',
          lastConnectionAttempt: Date.now(),
          errorMessage: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
    }

    return { success: true };
  } catch (error) {
    console.error('[connection-orchestrator] Test connection error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ignore a discovered device
 */
export async function ignoreDevice(
  hostId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  try {
    const host = await db
      .select()
      .from(discoveredHosts)
      .where(eq(discoveredHosts.id, hostId))
      .get();

    if (!host) {
      return { success: false, error: 'Host not found' };
    }

    const uniqueId = generateUniqueId(host.ipAddress, host.macAddress || undefined);
    const ignoreId = `ign_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Add to ignored list
    await db
      .insert(ignoredDiscoveries)
      .values({
        id: ignoreId,
        uniqueId,
        ipAddress: host.ipAddress,
        macAddress: host.macAddress,
        hostname: host.hostname,
        reason,
        ignoredAt: Date.now(),
        createdAt: Date.now(),
      })
      .run();

    // Update host status
    await db
      .update(discoveredHosts)
      .set({
        connectionStatus: 'ignored',
        ignoreReason: reason,
        ignoredAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(discoveredHosts.id, hostId))
      .run();

    return { success: true };
  } catch (error) {
    console.error('[connection-orchestrator] Ignore device error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Un-ignore a device
 */
export async function unignoreDevice(
  uniqueId: string,
): Promise<{ success: boolean; error?: string }> {
  const db = getDb();

  try {
    // Remove from ignored list
    await db
      .delete(ignoredDiscoveries)
      .where(eq(ignoredDiscoveries.uniqueId, uniqueId))
      .run();

    // Find hosts with this uniqueId and reset their status
    const [ipAddress, macAddress] = uniqueId.split(':');
    const host = await db
      .select()
      .from(discoveredHosts)
      .where(eq(discoveredHosts.ipAddress, ipAddress))
      .get();

    if (host) {
      await db
        .update(discoveredHosts)
        .set({
          connectionStatus: 'discovered',
          ignoreReason: null,
          ignoredAt: null,
          updatedAt: Date.now(),
        })
        .where(eq(discoveredHosts.id, host.id))
        .run();
    }

    return { success: true };
  } catch (error) {
    console.error('[connection-orchestrator] Un-ignore device error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
