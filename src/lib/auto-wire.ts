/**
 * Auto-Wiring Layer
 *
 * Subscribes to StdOut's event bus and cross-links entities automatically:
 *
 *   host.discovered        → create a monitor for the host (HTTP/ping)
 *   satellite.registered   → match against discovered_hosts by name/IP, link if found
 *   stack.created          → register with Observatory's watch list
 *   datasource.detected    → mark data source as verified in DB
 *   satellite.report       → update Observatory context if anomaly detected
 *
 * All handlers are fire-and-forget — errors are logged, never thrown.
 * Call initAutoWiring() once at server startup (middleware.ts).
 */

import { on } from './events';
import { getDb } from './db';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

let _initialized = false;

export function initAutoWiring(): void {
  if (_initialized) return;
  _initialized = true;

  on('host.discovered', async (e: Extract<import('./events').StdOutEvent, { type: 'host.discovered' }>) => {
    try {
      await autoCreateHostMonitor(e.userId, e.hostId, e.ip, e.hostname);
    } catch (err) {
      console.error('[auto-wire] host.discovered handler error:', err);
    }
  });

  on('satellite.registered', async (e: Extract<import('./events').StdOutEvent, { type: 'satellite.registered' }>) => {
    try {
      await linkSatelliteToHost(e.userId, e.agentId, e.name, e.tags);
    } catch (err) {
      console.error('[auto-wire] satellite.registered handler error:', err);
    }
  });

  on('stack.created', async (e: Extract<import('./events').StdOutEvent, { type: 'stack.created' }>) => {
    try {
      await notifyObservatoryOfStack(e.userId, e.stackId, e.name);
    } catch (err) {
      console.error('[auto-wire] stack.created handler error:', err);
    }
  });

  console.log('[auto-wire] initialized');
}

// ── Host discovered → auto-create an HTTP or ping monitor ─────────────────────

async function autoCreateHostMonitor(
  userId: string,
  hostId: string,
  ip: string,
  hostname: string | null,
): Promise<void> {
  const db = getDb();

  // Check if a monitor already targets this IP
  const existing = db.get(sql`
    SELECT id FROM monitors WHERE target LIKE ${'%' + ip + '%'}
    LIMIT 1
  `) as { id: string } | undefined;

  if (existing) return; // already monitored

  const label = hostname || ip;
  const monitorId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  // Try HTTP first (port 80). If the host has services we'll upgrade later.
  db.run(sql`
    INSERT INTO monitors (
      id, name, type, target, interval_seconds, timeout_ms,
      expected_status, retries, stack_id, paused, maintenance,
      current_status, consecutive_failures, created_at, updated_at
    ) VALUES (
      ${monitorId}, ${'[auto] ' + label}, 'ping', ${ip},
      300, 5000, NULL, 2, NULL, 0, 0, 'unknown', 0, ${now}, ${now}
    )
  `);

  console.log(`[auto-wire] created ping monitor for ${ip} (${label})`);
}

// ── Satellite registered → match to discovered_host ───────────────────────────

async function linkSatelliteToHost(
  userId: string,
  agentId: string,
  name: string,
  tags: string[],
): Promise<void> {
  const db = getDb();

  // Try to match by hostname (case-insensitive) or IP in the agent name
  // e.g. agent named "hetzner-web-01" matches host with hostname "hetzner-web-01"
  const host = db.get(sql`
    SELECT id, ip_address FROM discovered_hosts
    WHERE (
        lower(hostname) = lower(${name})
        OR ip_address = ${name}
      )
    LIMIT 1
  `) as { id: string; ip_address: string } | undefined;

  if (!host) return;

  // Record the link in system_state so Observatory can use it
  const centralDb = getDb();
  const now = Math.floor(Date.now() / 1000);
  centralDb.run(sql`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES (
      ${'satellite_host_link:' + agentId},
      ${JSON.stringify({ agentId, hostId: host.id, ip: host.ip_address, linkedAt: now })},
      ${now}
    )
  `);

  console.log(`[auto-wire] linked satellite ${agentId} to host ${host.id} (${host.ip_address})`);
}

// ── Stack created → tell Observatory to add it to the watch list ──────────────

async function notifyObservatoryOfStack(
  userId: string,
  stackId: string,
  name: string,
): Promise<void> {
  // Write a pending Observatory task into system_state.
  // The Watcher picks these up on its next tick and creates baselines.
  const centralDb = getDb();
  const now = Math.floor(Date.now() / 1000);

  centralDb.run(sql`
    INSERT OR IGNORE INTO system_state (key, value, updated_at)
    VALUES (
      ${'observatory_watch:' + stackId},
      ${JSON.stringify({ stackId, name, userId, queuedAt: now, status: 'pending' })},
      ${now}
    )
  `);

  console.log(`[auto-wire] queued Observatory watch for stack ${stackId} (${name})`);
}
