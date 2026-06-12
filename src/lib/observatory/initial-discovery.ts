/**
 * Initial network discovery — actually RUNS a scan on first boot and persists hosts.
 *
 * Before this, Observatory only set an "initial_scan_triggered" flag and waited for a human to
 * click Scan. The autonomic vision requires scanners/discovery to START collecting on their own.
 * This module performs a real ping sweep of the detected local subnets, persists each host to
 * discovered_hosts (matching the canonical path in api/network/import.ts), and emits
 * `host.discovered` so auto-wire creates monitors. It records a "collecting" state in system_state
 * so the UI can show that discovery is underway.
 *
 * Idempotent and safe: skips if a scan is already in progress; updates existing hosts in place.
 */

import { getTenantDb, getCentralDb } from '../db';
import { discoveredHosts, stacks } from '../db/tenant-schema';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { emit } from '../events';
import { getSetupConfig } from '../setup';
import { detectLocalSubnets } from '../network-utils';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const STATE_PROGRESS = 'observatory_discovery_state'; // idle | collecting | complete | error
const STATE_LAST_RUN = 'observatory_discovery_last_run';
const STATE_HOST_COUNT = 'observatory_discovery_host_count';

async function setState(key: string, value: string): Promise<void> {
  const db = getCentralDb();
  const now = Date.now();
  await db.run(sql`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (${key}, ${value}, ${now})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
}

export async function getDiscoveryState(): Promise<string> {
  const db = getCentralDb();
  const row = db.get(sql`SELECT value FROM system_state WHERE key = ${STATE_PROGRESS}`) as
    | { value: string }
    | undefined;
  return row?.value ?? 'idle';
}

/** Ping-sweep one subnet via nmap, return discovered IPs. */
async function pingSweep(subnet: string): Promise<Array<{ ip: string; hostname?: string }>> {
  const hosts: Array<{ ip: string; hostname?: string }> = [];
  try {
    const { stdout } = await execAsync(`nmap -sn -T4 --max-retries 1 ${subnet}`, { timeout: 60000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/Nmap scan report for (?:([^\s(]+) \()?([\d.]+)\)?/);
      if (m) {
        const ip = m[2];
        const hostname = m[1] && m[1] !== ip ? m[1] : undefined;
        hosts.push({ ip, hostname });
      }
    }
  } catch (err: any) {
    console.error('[initial-discovery] ping sweep failed for', subnet, err.message);
  }
  return hosts;
}

/** Get or create the user's default stack to link discovered hosts to. */
async function getOrCreateDefaultStack(userId: string): Promise<string> {
  const db = getTenantDb(userId);
  const existing = await db.select().from(stacks).where(eq(stacks.userId, userId)).limit(1);
  if (existing.length > 0) return existing[0].id;

  const now = new Date();
  const envName = await getSetupConfig('environment_name');
  const stackId = nanoid();
  await db.insert(stacks).values({
    id: stackId,
    userId,
    name: envName || 'My Environment',
    description: 'Automatically created from initial network discovery',
    createdAt: now,
    updatedAt: now,
  });
  return stackId;
}

/** Persist a host (insert or update), emitting host.discovered on first insert. */
async function persistHost(
  userId: string,
  stackId: string,
  ip: string,
  hostname: string | null
): Promise<void> {
  const db = getTenantDb(userId);
  const now = new Date();

  const existing = await db
    .select()
    .from(discoveredHosts)
    .where(and(eq(discoveredHosts.userId, userId), eq(discoveredHosts.ipAddress, ip)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(discoveredHosts)
      .set({ hostname: hostname || existing[0].hostname, lastSeen: now, updatedAt: now })
      .where(eq(discoveredHosts.id, existing[0].id));
    return;
  }

  const hostId = nanoid();
  await db.insert(discoveredHosts).values({
    id: hostId,
    userId,
    stackId,
    ipAddress: ip,
    hostname: hostname || null,
    macAddress: null,
    vendor: null,
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
  });
  emit({ type: 'host.discovered', userId, hostId, ip, hostname: hostname || null, stackId });
}

/**
 * Run a real initial discovery scan for a user. Detects local subnets, ping-sweeps each,
 * persists hosts, and emits host.discovered. Non-blocking caller-side (callers should not await
 * during startup). Returns the number of hosts found.
 */
export async function runInitialDiscovery(userId: string): Promise<number> {
  // Don't stack concurrent scans.
  if ((await getDiscoveryState()) === 'collecting') {
    console.log('[initial-discovery] already collecting — skipping');
    return 0;
  }

  await setState(STATE_PROGRESS, 'collecting');
  console.log('[initial-discovery] starting real initial discovery...');

  try {
    const subnets = await detectLocalSubnets();
    if (!subnets || subnets.length === 0) {
      console.log('[initial-discovery] no local subnets detected');
      await setState(STATE_PROGRESS, 'complete');
      await setState(STATE_HOST_COUNT, '0');
      return 0;
    }

    const stackId = await getOrCreateDefaultStack(userId);

    let total = 0;
    for (const subnet of subnets) {
      console.log('[initial-discovery] scanning', subnet);
      const hosts = await pingSweep(subnet);
      for (const h of hosts) {
        await persistHost(userId, stackId, h.ip, h.hostname ?? null);
        total++;
      }
    }

    await setState(STATE_HOST_COUNT, String(total));
    await setState(STATE_LAST_RUN, String(Date.now()));
    await setState(STATE_PROGRESS, 'complete');
    console.log(`[initial-discovery] complete — ${total} hosts discovered`);
    return total;
  } catch (err: any) {
    console.error('[initial-discovery] error:', err.message);
    await setState(STATE_PROGRESS, 'error');
    return 0;
  }
}
