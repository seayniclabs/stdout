/**
 * Recurring Network Scan Scheduler (P2b)
 *
 * Initial discovery runs once on boot (triggerInitialNetworkScan → runInitialDiscovery). But the
 * autonomic vision wants the system to KEEP discovering — networks change, hosts come and go. The
 * `scanner_schedule` table already lets a user configure cadence (interval + hour/minute/weekday),
 * but nothing consumed it. This wires it: a ticker checks every few minutes and re-runs discovery
 * for any user whose schedule is due, deduped per period so a due window fires exactly once.
 *
 * Reuses runInitialDiscovery (two-tier ARP + nmap + async deep scan) — the same path that already
 * persists hosts, emits host.discovered, and lets auto-wire create monitors.
 */

import { getDb } from '../../db';
import { sql } from 'drizzle-orm';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // evaluate schedules every 5 minutes
let _started = false;
// Per-user dedupe: remember the last period key we fired for, so we run once per due window.
const _lastRun = new Map<string, string>();

interface ScheduleRow {
  user_id: string;
  interval: string;   // 'hourly' | 'daily' | 'weekly' | (cron not yet supported here)
  hour: number;
  minute: number;
  weekday: number;    // 0=Sun..6=Sat
  enabled: number;
}

/**
 * Decide whether a schedule is due "now", and return a stable period key for dedupe.
 * Returns null when not due. Times are evaluated in UTC (matches the other StdOut schedulers).
 * Exported for unit testing.
 */
export function dueKey(row: ScheduleRow, now: Date): string | null {
  const min = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  const dateStr = now.toISOString().split('T')[0];

  // The 5-min ticker means "minute === row.minute" rarely lines up exactly; match a 5-min window.
  const minuteMatches = Math.abs(min - row.minute) < 5 || min >= row.minute && min < row.minute + 5;

  switch (row.interval) {
    case 'hourly':
      // Fire once per hour at ~row.minute. Period key = date+hour.
      return minuteMatches ? `${dateStr}T${hour}` : null;
    case 'weekly':
      // Fire once per week on row.weekday at ~row.hour:row.minute. Period key = ISO week-ish.
      if (day === row.weekday && hour === row.hour && minuteMatches) {
        return `${dateStr}`; // a given weekday occurs once per date — date is a fine period key
      }
      return null;
    case 'daily':
    default:
      // Fire once per day at ~row.hour:row.minute. Period key = date.
      if (hour === row.hour && minuteMatches) return dateStr;
      return null;
  }
}

async function tick(): Promise<void> {
  const db = getDb();
  let rows: ScheduleRow[];
  try {
    rows = db.all(sql`
      SELECT user_id, interval, hour, minute, weekday, enabled
      FROM scanner_schedule
      WHERE enabled = 1
    `) as ScheduleRow[];
  } catch (error: unknown) {
    console.error('[passive-discovery-worker] failed to read schedules:', error instanceof Error ? error.message : String(error));
    return;
  }

  if (rows.length === 0) return;
  const now = new Date();

  for (const row of rows) {
    const key = dueKey(row, now);
    if (!key) continue;
    const dedupeKey = `${row.user_id}:${row.interval}`;
    if (_lastRun.get(dedupeKey) === key) continue; // already fired this period
    _lastRun.set(dedupeKey, key);

    console.log(`[passive-discovery-worker] re-scan due for user ${row.user_id} (${row.interval}) — triggering discovery`);
    try {
      const { runInitialDiscovery } = await import('../initial-discovery');
      // Fire-and-forget — discovery is resilient and self-logging; don't block the ticker.
      runInitialDiscovery(row.user_id).catch((e) =>
        console.error(`[passive-discovery-worker] discovery failed for ${row.user_id}:`, e),
      );
    } catch (error: unknown) {
      console.error('[passive-discovery-worker] could not start discovery:', error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * Ensure the user has a scanner_schedule row so recurring discovery actually runs. The autonomic
 * vision auto-configures everything, so on first boot we seed a sensible default (daily at 03:00
 * UTC) if the user has none. Idempotent: never overwrites an existing schedule.
 */
export async function ensureDefaultSchedule(userId: string): Promise<boolean> {
  const db = getDb();
  try {
    const existing = db.get(sql`SELECT id FROM scanner_schedule WHERE user_id = ${userId} LIMIT 1`) as { id: string } | undefined;
    if (existing) return false;
    const id = `sched_${userId}`;
    db.run(sql`
      INSERT INTO scanner_schedule (id, user_id, interval, hour, minute, weekday, enabled, modules, subnets, updated_at)
      VALUES (${id}, ${userId}, 'daily', 3, 0, 0, 1, '["network","docker","metrics"]', ${null}, ${Date.now()})
      ON CONFLICT(id) DO NOTHING
    `);
    return true;
  } catch (error: unknown) {
    console.error('[passive-discovery-worker] failed to seed default schedule:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Start the recurring-scan ticker. Idempotent. Call once at service startup. */
export function startPassiveDiscoveryWorker(): void {
  if (_started) return;
  _started = true;
  setInterval(() => {
    tick().catch((error) => console.error('[passive-discovery-worker] tick error:', error));
  }, CHECK_INTERVAL_MS);
  console.log('[passive-discovery-worker] started — checking scanner_schedule every 5 min');
}
