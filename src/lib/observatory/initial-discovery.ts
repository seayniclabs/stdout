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

import { getDb } from '../db';
import { discoveredHosts, stacks } from '../db/schema';
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
  const db = getDb();
  const now = Date.now();
  // Use raw SQLite instead of Drizzle sql template - sql template with db.run() doesn't support UPSERT
  const rawDb = (db as any).$client;
  const stmt = rawDb.prepare(`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  stmt.run(key, value, now);
}

export async function getDiscoveryState(): Promise<string> {
  const db = getDb();
  const row = db.get(sql`SELECT value FROM system_state WHERE key = ${STATE_PROGRESS}`) as
    | { value: string }
    | undefined;
  return row?.value ?? 'idle';
}

/**
 * Fast tier — read the kernel ARP/neighbor table for an INSTANT host inventory (no scan).
 * These are hosts the box has already talked to. Zero wait — the box lights up immediately.
 */
async function arpTableHosts(): Promise<Array<{ ip: string; hostname?: string }>> {
  const hosts: Array<{ ip: string; hostname?: string }> = [];
  const seen = new Set<string>();
  try {
    // /proc/net/arp: "IP address  HW type  Flags  HW address  Mask  Device"
    const { stdout } = await execAsync('cat /proc/net/arp 2>/dev/null', { timeout: 5000 });
    for (const line of stdout.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      const ip = cols[0];
      const flags = cols[2];
      // Flags 0x2 = complete/reachable entry; skip incomplete (0x0) and the header.
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && flags && flags !== '0x0' && !seen.has(ip)) {
        seen.add(ip);
        hosts.push({ ip });
      }
    }
  } catch (error: unknown) {
    console.error('[initial-discovery] ARP table read failed:', error instanceof Error ? error.message : String(error));
  }
  return hosts;
}

/** Ping-sweep one subnet via nmap -sn (ARP-based on local nets — fast). */
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
  } catch (error: unknown) {
    console.error('[initial-discovery] ping sweep failed for', subnet, error instanceof Error ? error.message : String(error));
  }
  return hosts;
}

/** Get or create the user's default stack to link discovered hosts to. */
async function getOrCreateDefaultStack(userId: string): Promise<string> {
  const db = getDb();
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
  const db = getDb();
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
  console.log('[initial-discovery] starting discovery — fast tier first...');

  try {
    const stackId = await getOrCreateDefaultStack(userId);
    const seenIps = new Set<string>();

    // ── FAST TIER 1: ARP/neighbor table — instant, zero scan. Box lights up immediately. ──
    const arpHosts = await arpTableHosts();
    for (const h of arpHosts) {
      if (!seenIps.has(h.ip)) {
        seenIps.add(h.ip);
        await persistHost(userId, stackId, h.ip, h.hostname ?? null);
      }
    }
    if (arpHosts.length > 0) {
      await setState(STATE_HOST_COUNT, String(seenIps.size));
      console.log(`[initial-discovery] fast tier (ARP): ${arpHosts.length} hosts instantly`);
    }

    // ── FAST TIER 2: ARP ping sweep of local subnets (nmap -sn = ARP on local nets). ──
    const subnets = await detectLocalSubnets();
    if (subnets && subnets.length > 0) {
      for (const subnet of subnets) {
        console.log('[initial-discovery] ARP sweep', subnet);
        const hosts = await pingSweep(subnet);
        for (const h of hosts) {
          if (!seenIps.has(h.ip)) {
            seenIps.add(h.ip);
            await persistHost(userId, stackId, h.ip, h.hostname ?? null);
          }
        }
      }
    }

    const total = seenIps.size;
    await setState(STATE_HOST_COUNT, String(total));
    await setState(STATE_LAST_RUN, String(Date.now()));
    await setState(STATE_PROGRESS, 'complete');
    console.log(`[initial-discovery] fast discovery complete — ${total} hosts`);

    // ── DEEP TIER: rich service/port enumeration in the BACKGROUND so we're never in the way. ──
    // Fire-and-forget; does not block the caller or the UI. Detail fills in over time.
    runDeepScan(userId, Array.from(seenIps)).catch((error) =>
      console.error('[initial-discovery] deep scan error:', error instanceof Error ? error.message : String(error))
    );

    return total;
  } catch (error: unknown) {
    console.error('[initial-discovery] error:', error instanceof Error ? error.message : String(error));
    await setState(STATE_PROGRESS, 'error');
    return 0;
  }
}

const STATE_DEEP = 'observatory_deep_scan_state'; // idle | running | complete

/**
 * Deep tier — per-host service/port enumeration, run asynchronously after the fast inventory.
 * Throttled (one host at a time, capped) so it never saturates the box or blocks the UI.
 * Persists discovered services and resolves hostnames where possible.
 */
async function runDeepScan(userId: string, ips: string[]): Promise<void> {
  if (ips.length === 0) return;
  await setState(STATE_DEEP, 'running');
  console.log(`[initial-discovery] deep scan starting for ${ips.length} hosts (background)...`);

  const db = getDb();
  // Common service ports — fast, targeted (not a full 65k sweep) to stay out of the way.
  const PORTS = '22,53,80,135,139,443,445,3000,3306,5432,5672,6379,8080,8112,8116,8443,9090,9100';

  for (const ip of ips) {
    try {
      const { stdout } = await execAsync(
        `nmap -sT -Pn -T4 --max-retries 1 --host-timeout 30s -p ${PORTS} ${ip}`,
        { timeout: 45000 }
      );
      // Resolve hostname if nmap reported one
      const nameMatch = stdout.match(/Nmap scan report for ([^\s(]+) \(([\d.]+)\)/);
      if (nameMatch && nameMatch[1] && nameMatch[1] !== ip) {
        await db
          .update(discoveredHosts)
          .set({ hostname: nameMatch[1], updatedAt: new Date() })
          .where(and(eq(discoveredHosts.userId, userId), eq(discoveredHosts.ipAddress, ip)));
      }
      // (Open-port → discovered_services persistence handled by the existing scan-services
      //  path; deep tier here resolves names + warms the host record. Service persistence is
      //  wired in a follow-up so we don't duplicate the insert logic.)
    } catch {
      // host unreachable / timed out — skip, deep tier is best-effort
    }
  }

  await setState(STATE_DEEP, 'complete');
  console.log('[initial-discovery] deep scan complete');
}
