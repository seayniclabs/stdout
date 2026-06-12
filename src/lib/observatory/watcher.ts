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

import { getCentralDb, getTenantDb } from '../db';
import { sql } from 'drizzle-orm';
import { emit } from '../events';
import { runScheduledCheck, createIncidentFromAnomaly } from './sentinel';

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

  console.log('[watcher] scheduled — first check in 3 min');
}

async function bootstrap(): Promise<void> {
  const db = getCentralDb();
  const users = db.all(sql`SELECT id FROM users WHERE role != 'deleted'`) as { id: string }[];

  for (const { id: userId } of users) {
    if (_userIntervals.has(userId)) continue; // already running

    const INTERVAL_MS = 3 * 60 * 1000; // 3 min, matches Watcher persona
    const iv = setInterval(() => {
      runCheckForUser(userId).catch(err =>
        console.error(`[watcher] check error for user ${userId}:`, err)
      );
    }, INTERVAL_MS);
    _userIntervals.set(userId, iv);

    console.log(`[watcher] started monitoring for user ${userId}`);

    // Immediate first check
    runCheckForUser(userId).catch(err =>
      console.error(`[watcher] first check error for user ${userId}:`, err)
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
    const db = getTenantDb(userId);
    const recentIncidents = db.all(sql`
      SELECT id, stack_id, severity, title FROM incidents
      WHERE user_id = ${userId}
        AND tags LIKE '%observatory%'
        AND created_at > ${Math.floor(Date.now() / 1000) - 300}
      ORDER BY created_at DESC
      LIMIT 5
    `) as Array<{ id: string; stack_id: string; severity: string; title: string }>;

    const incidentIds: string[] = [];
    for (const inc of recentIncidents) {
      emit({
        type: 'observatory.anomaly',
        userId,
        stackId: inc.stack_id,
        severity: inc.severity,
        metric: inc.title,
      });
      if ((inc as any).id) incidentIds.push((inc as any).id);
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
  const db = getCentralDb();

  const pending = db.all(sql`
    SELECT key, value FROM system_state
    WHERE key LIKE 'observatory_watch:%'
  `) as Array<{ key: string; value: string }>;

  for (const row of pending) {
    let entry: { stackId: string; userId: string; status: string; queuedAt: number; name: string };
    try {
      entry = JSON.parse(row.value);
    } catch {
      continue;
    }

    if (entry.status !== 'pending') continue;

    // Mark as processing
    db.run(sql`
      UPDATE system_state
      SET value = ${JSON.stringify({ ...entry, status: 'processing' })}, updated_at = ${Math.floor(Date.now() / 1000)}
      WHERE key = ${row.key}
    `);

    try {
      await ensureStackMonitored(entry.userId, entry.stackId, entry.name);

      // Mark done
      db.run(sql`
        UPDATE system_state
        SET value = ${JSON.stringify({ ...entry, status: 'done', doneAt: Math.floor(Date.now() / 1000) })},
            updated_at = ${Math.floor(Date.now() / 1000)}
        WHERE key = ${row.key}
      `);

      console.log(`[watcher] queued stack ${entry.stackId} (${entry.name}) now being watched`);
    } catch (err) {
      console.error(`[watcher] failed to process watch queue entry ${row.key}:`, err);
      db.run(sql`
        UPDATE system_state
        SET value = ${JSON.stringify({ ...entry, status: 'error', error: String(err) })},
            updated_at = ${Math.floor(Date.now() / 1000)}
        WHERE key = ${row.key}
      `);
    }
  }
}

async function ensureStackMonitored(userId: string, stackId: string, stackName: string): Promise<void> {
  const db = getTenantDb(userId);

  // Check if the stack already has a monitor
  const existing = db.get(sql`
    SELECT id FROM monitors WHERE user_id = ${userId} AND stack_id = ${stackId} LIMIT 1
  `) as { id: string } | undefined;

  if (existing) return;

  // Count hosts linked to this stack
  const hosts = db.all(sql`
    SELECT id, ip_address, hostname FROM discovered_hosts
    WHERE user_id = ${userId} AND stack_id = ${stackId}
  `) as Array<{ id: string; ip_address: string; hostname: string | null }>;

  const now = Math.floor(Date.now() / 1000);

  // Create a ping monitor for each host in the stack
  for (const host of hosts) {
    const label = host.hostname || host.ip_address;
    const monitorId = `mon_${Date.now()}_${host.id.slice(0, 8)}`;

    db.run(sql`
      INSERT OR IGNORE INTO monitors (
        id, user_id, name, type, target, interval_seconds, timeout_ms,
        expected_status, retries, stack_id, paused, maintenance,
        current_status, consecutive_failures, created_at, updated_at
      ) VALUES (
        ${monitorId}, ${userId}, ${'[auto] ' + label}, 'ping', ${host.ip_address},
        300, 5000, NULL, 2, ${stackId}, 0, 0, 'unknown', 0, ${now}, ${now}
      )
    `);

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
    const centralDb = getCentralDb();
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
