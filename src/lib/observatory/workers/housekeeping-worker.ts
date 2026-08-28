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
  const rawDb = (db as any).$client;
  const GRACE_PERIOD_SEC = 5 * 60; // 5 minutes
  const cutoff = Math.floor(Date.now() / 1000) - GRACE_PERIOD_SEC;

  const undiagnosed = rawDb.prepare(`
    SELECT i.id, i.title
    FROM incidents i
    LEFT JOIN diagnoses d ON d.incident_id = i.id
    WHERE i.status = 'active'
      AND d.id IS NULL
      AND i.created_at < ?
    ORDER BY i.created_at ASC
    LIMIT 50
  `).all(cutoff) as Array<{ id: string; title: string }>;

  if (undiagnosed.length === 0) return;

  console.log(`[housekeeping-worker] Found ${undiagnosed.length} undiagnosed incident(s), processing...`);

  // reflexForIncidents: already refactored for single-instance mode (userId removed in Phase 1.1)
  // For now, housekeeping auto-diagnosis is disabled pending refactor
  console.log(`[housekeeping-worker] Found ${undiagnosed.length} undiagnosed incidents (auto-diagnosis disabled in single-instance mode)`);
}
