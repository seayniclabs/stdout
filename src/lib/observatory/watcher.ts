/**
 * Observatory Watcher Loop
 *
 * This is the background process that drives continuous observability:
 *
 *   1. Discovers all active users at startup
 *   2. Starts a Sentinel interval per user (checks stacks every 3 min)
 *   3. Processes the observatory_watch queue populated by auto-wiring
 *   4. Emits events when anomalies are found so the UI and incident system react
 *
 * Call startWatcher() once at middleware startup. It is idempotent.
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { emit } from '../events';
import { runScheduledCheck, createIncidentFromAnomaly } from './sentinel';
import { startPassiveDiscoveryWorker } from './workers/passive-discovery-worker';
import { startStorageMonitorWorker } from './workers/storage-monitor-worker';
import { startHousekeepingWorker } from './workers/housekeeping-worker';

let _started = false;
const _userIntervals = new Map<string, ReturnType<typeof setInterval>>();

export function startWatcher(): void {
  if (_started) return;
  _started = true;

  // Give the container ~3 min to fully come up before the first check
  setTimeout(() => {
    bootstrap().catch(err => console.error('[watcher] bootstrap error:', err));

    // Re-bootstrap every 10 minutes to pick up newly registered users
    setInterval(() => {
      bootstrap().catch(err => console.error('[watcher] re-bootstrap error:', err));
    }, 10 * 60 * 1000);
  }, 3 * 60 * 1000);

  // Queue processor — pick up observatory_watch entries every 30 seconds
  setInterval(() => {
    processWatchQueue().catch(err => console.error('[watcher] queue processor error:', err));
  }, 30 * 1000);

  // Start external workers
  startPassiveDiscoveryWorker();
  startStorageMonitorWorker();
  startHousekeepingWorker();

  console.log('[watcher] scheduled — first check in 3 min');
}

async function bootstrap(): Promise<void> {
  const db = getDb();
  const rawDb = (db as any).$client;
  const users = rawDb.prepare(`SELECT id FROM users WHERE role != ?`).all('deleted') as { id: string }[];

  for (const { id: userId } of users) {
    if (_userIntervals.has(userId)) {
      console.log(`[watcher] skipping duplicate bootstrap for user ${userId}`);
      continue; // already running
    }

    const INTERVAL_MS = 3 * 60 * 1000; // 3 min, matches Watcher persona
    const iv = setInterval(() => {
      runCheckForUser(userId).catch(err =>
        console.error(
          JSON.stringify({
            level: 'ERROR',
            module: 'watcher',
            timestamp: new Date().toISOString(),
            msg: `Check error for user ${userId}`,
            error: err instanceof Error ? err.message : String(err),
            userId,
          })
        )
      );
    }, INTERVAL_MS);
    _userIntervals.set(userId, iv);

    console.log(`[watcher] started monitoring for user ${userId}`);

    // Immediate first check
    runCheckForUser(userId).catch(err =>
      console.error(
        JSON.stringify({
          level: 'ERROR',
          module: 'watcher',
          timestamp: new Date().toISOString(),
          msg: `First check error for user ${userId}`,
          error: err instanceof Error ? err.message : String(err),
          userId,
        })
      )
    );
  }
}

async function runCheckForUser(userId: string): Promise<void> {
  const result = await runScheduledCheck(userId);

  emit({
    type: 'watcher.tick',
    userId,
    stacksChecked: result.stacksChecked,
    anomaliesFound: result.anomaliesDetected,
  });

  if (result.anomaliesDetected > 0) {
    // anomalies were already turned into incidents by runScheduledCheck
    // emit per-stack anomaly events so Observatory status page can react
    const db = getDb();
    const rawDb = (db as any).$client;
    const recentIncidents = rawDb.prepare(`
      SELECT id, stack_id, severity, title FROM incidents
      WHERE tags LIKE '%observatory%'
        AND created_at > ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(Math.floor(Date.now() / 1000) - 300) as Array<{ id: string; stack_id: string; severity: string; title: string }>;

    const incidentIds: string[] = [];
    for (const inc of recentIncidents) {
      emit({
        type: 'observatory.anomaly',
        userId,
        stackId: inc.stack_id,
        severity: inc.severity,
        metric: inc.title,
      });
      if (inc.id) incidentIds.push(inc.id);
    }

    // THE REFLEX ARC: detection just created incidents — now act on them per the operating mode,
    // with NO HTTP trigger. discover = nothing; diagnose = auto-diagnose; autofix = diagnose + gated
    // apply. This is what makes the loop self-running. Fire-and-forget; never blocks the tick.
    if (incidentIds.length > 0) {
      import('./reflex')
        .then(({ reflexForIncidents }) => reflexForIncidents(userId, incidentIds))
        .then((outcomes) => {
          const acted = outcomes.filter((o) => o.diagnosed || o.applied || o.parked);
          if (acted.length > 0) {
            console.log(`[reflex] ${userId}: ${acted.length} incident(s) acted on`,
              acted.map((o) => `${o.incidentId.slice(0, 8)}:${o.diagnosed ? 'dx' : ''}${o.applied ? `+${o.applied}fix` : ''}${o.parked ? `+${o.parked}park` : ''}`).join(' '));
          }
        })
        .catch((err) => console.error('[reflex] error:', err));
    }
  }
}

async function processWatchQueue(): Promise<void> {
  const db = getDb();
  const rawDb = (db as any).$client;

  const pending = rawDb.prepare(`
    SELECT key, value FROM system_state
    WHERE key LIKE ?
  `).all('observatory_watch:%') as Array<{ key: string; value: string }>;

  for (const row of pending) {
    let entry: { stackId: string; userId: string; status: string; queuedAt: number; name: string };
    try {
      entry = JSON.parse(row.value);
    } catch {
      continue;
    }

    if (entry.status !== 'pending') continue;

    // Mark as processing
    rawDb.prepare(`
      UPDATE system_state
      SET value = ?, updated_at = ?
      WHERE key = ?
    `).run(JSON.stringify({ ...entry, status: 'processing' }), Math.floor(Date.now() / 1000), row.key);

    try {
      await ensureStackMonitored(entry.userId, entry.stackId, entry.name);

      // Mark done
      rawDb.prepare(`
        UPDATE system_state
        SET value = ?,
            updated_at = ?
        WHERE key = ?
      `).run(JSON.stringify({ ...entry, status: 'done', doneAt: Math.floor(Date.now() / 1000) }), Math.floor(Date.now() / 1000), row.key);

      console.log(`[watcher] queued stack ${entry.stackId} (${entry.name}) now being watched`);
    } catch (err) {
      console.error(`[watcher] failed to process watch queue entry ${row.key}:`, err);
      rawDb.prepare(`
        UPDATE system_state
        SET value = ?,
            updated_at = ?
        WHERE key = ?
      `).run(JSON.stringify({ ...entry, status: 'error', error: String(err) }), Math.floor(Date.now() / 1000), row.key);
    }
  }
}



async function ensureStackMonitored(userId: string, stackId: string, stackName: string): Promise<void> {
  const db = getDb();
  const rawDb = (db as any).$client;

  // Check if the stack already has a monitor
  const existing = rawDb.prepare(`
    SELECT id FROM monitors WHERE stack_id = ? LIMIT 1
  `).get(stackId) as { id: string } | undefined;

  if (existing) return;

  // Count hosts linked to this stack
  const hosts = rawDb.prepare(`
    SELECT id, ip_address, hostname FROM discovered_hosts
    WHERE stack_id = ?
  `).all(stackId) as Array<{ id: string; ip_address: string; hostname: string | null }>;

  const now = Math.floor(Date.now() / 1000);

  // Create a ping monitor for each host in the stack
  for (const host of hosts) {
    const label = host.hostname || host.ip_address;
    const monitorId = `mon_${Date.now()}_${host.id.slice(0, 8)}`;

    rawDb.prepare(`
      INSERT OR IGNORE INTO monitors (
        id, name, type, target, interval_seconds, timeout_ms,
        expected_status, retries, stack_id, paused, maintenance,
        current_status, consecutive_failures, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(monitorId, '[auto] ' + label, 'ping', host.ip_address, 300, 5000, null, 2, stackId, 0, 0, 'unknown', 0, now, now);

    emit({
      type: 'monitor.created',
      userId,
      monitorId,
      name: '[auto] ' + label,
      targetType: 'host',
    });
  }

  if (hosts.length === 0) {
    console.log(`[watcher] stack ${stackId} has no hosts yet — will retry on next queue pass`);
    // Reset to pending so it's re-tried when hosts arrive
    const centralDb = getDb();
    const key = `observatory_watch:${stackId}`;
    const existing = centralDb.get(sql`SELECT value FROM system_state WHERE key = ${key}`) as { value: string } | undefined;
    if (existing) {
      const entry = JSON.parse(existing.value);
      centralDb.run(sql`
        UPDATE system_state SET value = ${JSON.stringify({ ...entry, status: 'pending' })},
        updated_at = ${now} WHERE key = ${key}
      `);
    }
  }
}
