import { getDb } from '../../db';
import { sql } from 'drizzle-orm';

let _started = false;

export function startHousekeepingWorker(): void {
  if (_started) return;
  _started = true;
  
  // Run first pass after 3.5 minutes
  setTimeout(() => {
    processPendingDiagnoses().catch(err => console.error('[housekeeping-worker] initial pass error:', err));
  }, 3.5 * 60 * 1000);

  // Run every 5 minutes
  setInterval(() => {
    processPendingDiagnoses().catch(err => console.error('[housekeeping-worker] error:', err));
  }, 5 * 60 * 1000);
  
  console.log('[housekeeping-worker] scheduled');
}

/**
 * Process undiagnosed incidents — catches incidents created by external sources
 * (health monitors, external API, manual creation) that bypass the Watcher's
 * own anomaly detection flow.
 */
async function processPendingDiagnoses(): Promise<void> {
  const db = getDb();
  const GRACE_PERIOD_SEC = 5 * 60; // 5 minutes
  const cutoff = Math.floor(Date.now() / 1000) - GRACE_PERIOD_SEC;

  const undiagnosed = db.all(sql`
    SELECT i.id, i.user_id, i.title
    FROM incidents i
    LEFT JOIN diagnoses d ON d.incident_id = i.id
    WHERE i.status = 'active'
      AND d.id IS NULL
      AND i.created_at < ${cutoff}
    ORDER BY i.created_at ASC
    LIMIT 50
  `) as Array<{ id: string; user_id: string; title: string }>;

  if (undiagnosed.length === 0) return;

  console.log(`[housekeeping-worker] Found ${undiagnosed.length} undiagnosed incident(s), processing...`);

  const byUser = new Map<string, string[]>();
  for (const inc of undiagnosed) {
    const ids = byUser.get(inc.user_id) || [];
    ids.push(inc.id);
    byUser.set(inc.user_id, ids);
  }

  for (const [userId, incidentIds] of byUser) {
    try {
      const { reflexForIncidents } = await import('../reflex');
      const outcomes = await reflexForIncidents(userId, incidentIds);

      const acted = outcomes.filter(o => o.diagnosed || o.applied || o.parked);
      if (acted.length > 0) {
        console.log(`[housekeeping-worker] ${userId}: diagnosed ${acted.length}/${incidentIds.length} incident(s)`);
      }
    } catch (err) {
      console.error(`[housekeeping-worker] failed for user ${userId}:`, err);
    }
  }
}
