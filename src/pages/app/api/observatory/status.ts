import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { sql } from 'drizzle-orm';

/**
 * GET /app/api/observatory/status
 *
 * Returns live Observatory state for the status page:
 *   - Watcher last tick, next scheduled check
 *   - Stacks being watched + host counts
 *   - Recent events from event_log
 *   - Satellite summary
 *   - Recent auto-created incidents
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const centralDb = getDb();
  const db = getDb();
  const userId = locals.user.id;
  const now = Math.floor(Date.now() / 1000);

  // ── Watcher state ─────────────────────────────────────────────────────────
  const watcherTickRow = centralDb.get(sql`
    SELECT value FROM system_state WHERE key = 'observatory_last_startup'
  `) as { value: string } | undefined;

  const lastStartupMs = watcherTickRow ? parseInt(watcherTickRow.value, 10) : null;

  // ── Stacks ────────────────────────────────────────────────────────────────
  const stacks = db.all(sql`
    SELECT s.id, s.name, s.created_at,
      (SELECT COUNT(*) FROM discovered_hosts h WHERE h.user_id = ${userId} AND h.stack_id = s.id) as host_count,
      (SELECT COUNT(*) FROM monitors m WHERE m.user_id = ${userId} AND m.stack_id = s.id) as monitor_count
    FROM stacks s WHERE s.user_id = ${userId}
    ORDER BY s.created_at DESC LIMIT 20
  `) as Array<{ id: string; name: string; created_at: number; host_count: number; monitor_count: number }>;

  // ── Discovered hosts ──────────────────────────────────────────────────────
  const hosts = db.all(sql`
    SELECT id, ip_address, hostname, stack_id, last_seen
    FROM discovered_hosts WHERE user_id = ${userId}
    ORDER BY last_seen DESC LIMIT 50
  `) as Array<{ id: string; ip_address: string; hostname: string | null; stack_id: string | null; last_seen: number }>;

  // ── Satellite agents ──────────────────────────────────────────────────────
  const satellites = centralDb.all(sql`
    SELECT id, name, alert_state, last_seen, tags FROM satellite_agents
    WHERE user_id = ${userId} ORDER BY created_at DESC
  `) as Array<{ id: string; name: string; alert_state: string; last_seen: number | null; tags: string }>;

  // ── Recent events (last 100) ──────────────────────────────────────────────
  let recentEvents: Array<{ id: string; type: string; payload: string; created_at: number }> = [];
  try {
    recentEvents = db.all(sql`
      SELECT id, type, payload, created_at FROM event_log
      WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 100
    `) as typeof recentEvents;
  } catch {
    // event_log may not exist yet on this tenant DB — fall back to central
    try {
      recentEvents = centralDb.all(sql`
        SELECT id, type, payload, created_at FROM event_log
        WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT 100
      `) as typeof recentEvents;
    } catch { /* table not yet created */ }
  }

  // ── Recent Observatory incidents ──────────────────────────────────────────
  const autoIncidents = db.all(sql`
    SELECT id, title, severity, status, stack_id, created_at
    FROM incidents
    WHERE user_id = ${userId} AND tags LIKE '%observatory%'
    ORDER BY created_at DESC LIMIT 20
  `) as Array<{ id: string; title: string; severity: string; status: string; stack_id: string | null; created_at: number }>;

  // ── Observatory watch queue status ────────────────────────────────────────
  const watchQueue = centralDb.all(sql`
    SELECT key, value FROM system_state WHERE key LIKE 'observatory_watch:%'
  `) as Array<{ key: string; value: string }>;

  const watchQueueParsed = watchQueue.map(r => {
    try { return JSON.parse(r.value); } catch { return null; }
  }).filter(Boolean);

  return new Response(JSON.stringify({
    watcher: {
      lastStartup: lastStartupMs,
      uptimeSeconds: lastStartupMs ? now - Math.floor(lastStartupMs / 1000) : null,
    },
    stacks,
    hosts: hosts.map(h => ({
      id: h.id,
      ip: h.ip_address,
      hostname: h.hostname,
      stackId: h.stack_id,
      lastSeenAgo: h.last_seen ? now - Math.floor(new Date(h.last_seen).getTime() / 1000) : null,
    })),
    satellites: satellites.map(s => ({
      id: s.id,
      name: s.name,
      alertState: s.alert_state,
      lastSeenAgo: s.last_seen ? now - s.last_seen : null,
      tags: JSON.parse(s.tags || '[]'),
    })),
    events: recentEvents.map(e => ({
      id: e.id,
      type: e.type,
      payload: (() => { try { return JSON.parse(e.payload); } catch { return {}; } })(),
      createdAt: e.created_at,
    })),
    incidents: autoIncidents,
    watchQueue: watchQueueParsed,
  }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
