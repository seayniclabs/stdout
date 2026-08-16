/**
 * StdOut Internal Event Bus
 *
 * Typed, in-process event system. Emitters are fire-and-forget; subscribers
 * run asynchronously and never block the emitter. All events are also persisted
 * to system_state so the Observatory can replay the startup sequence on boot.
 *
 * Event types drive the auto-wiring layer: when a host is discovered, monitors
 * spin up; when a satellite registers, it maps to a host; when a stack is
 * imported, Observatory adds it to its watch list.
 */

import { getDb } from './db';
import { sql } from 'drizzle-orm';

// ── Event catalog ─────────────────────────────────────────────────────────────

export type StdOutEvent =
  | { type: 'host.discovered';       userId: string; hostId: string; ip: string; hostname: string | null; stackId: string | null }
  | { type: 'host.updated';          userId: string; hostId: string; ip: string }
  | { type: 'stack.created';         userId: string; stackId: string; name: string; source: 'import' | 'manual' | 'auto' }
  | { type: 'stack.updated';         userId: string; stackId: string }
  | { type: 'satellite.registered';  userId: string; agentId: string; name: string; tags: string[] }
  | { type: 'satellite.report';      userId: string; agentId: string; alertState: 'ok' | 'warning' | 'critical' | 'stale' }
  | { type: 'satellite.stale';       userId: string; agentId: string; name: string; silentMinutes: number }
  | { type: 'datasource.detected';   userId: string; sourceId: string; sourceType: string; url: string }
  | { type: 'monitor.created';       userId: string; monitorId: string; name: string; targetType: 'host' | 'stack' | 'satellite' | 'url' }
  | { type: 'monitor.down';          userId: string; monitorId: string; name: string }
  | { type: 'monitor.up';            userId: string; monitorId: string; name: string }
  | { type: 'incident.created';      userId: string; incidentId: string; severity: string; title: string }
  | { type: 'incident.resolved';     userId: string; incidentId: string }
  | { type: 'observatory.started';   userId: string; mode: string }
  | { type: 'observatory.anomaly';   userId: string; stackId: string; severity: string; metric: string }
  | { type: 'scanner.complete';      userId: string; hostsFound: number; subnet: string }
  | { type: 'watcher.tick';          userId: string; stacksChecked: number; anomaliesFound: number };

type EventType = StdOutEvent['type'];
type Handler<T extends StdOutEvent> = (event: T) => Promise<void> | void;

// ── Registry ──────────────────────────────────────────────────────────────────

const _handlers = new Map<EventType, Handler<any>[]>();

export function on<T extends StdOutEvent>(type: T['type'], handler: Handler<T>): void {
  const list = _handlers.get(type) ?? [];
  list.push(handler);
  _handlers.set(type, list);
}

export function off<T extends StdOutEvent>(type: T['type'], handler: Handler<T>): void {
  const list = _handlers.get(type) ?? [];
  _handlers.set(type, list.filter(h => h !== handler));
}

// ── Emit ─────────────────────────────────────────────────────────────────────

export function emit(event: StdOutEvent): void {
  // Persist event to DB (non-blocking, best-effort)
  persistEvent(event).catch(err =>
    console.error(`[events] persist failed for ${event.type}:`, err)
  );

  // Dispatch to handlers asynchronously — emitter is never blocked
  const handlers = _handlers.get(event.type) ?? [];
  for (const handler of handlers) {
    Promise.resolve(handler(event as any)).catch(err =>
      console.error(`[events] handler error for ${event.type}:`, err)
    );
  }
}

async function persistEvent(event: StdOutEvent): Promise<void> {
  try {
    const db = getDb();
    const rawDb = (db as any).$client;
    const now = Math.floor(Date.now() / 1000);
    rawDb.prepare(`
      INSERT INTO event_log (id, type, user_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), event.type, (event as any).userId ?? null, JSON.stringify(event), now);
  } catch {
    // Table may not exist yet on first boot — not fatal
  }
}

// ── DB schema (added via apply-schema) ───────────────────────────────────────
// event_log table is created in apply-schema.js and db/index.ts
