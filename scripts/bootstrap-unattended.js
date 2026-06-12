#!/usr/bin/env node
/**
 * Zero-touch unattended bootstrap.
 *
 * Runs from init-setup.sh when ADMIN_EMAIL/ADMIN_PASSWORD are present (the headless,
 * non-wizard install path). It brings a clean container to a fully-installed state without
 * a browser wizard or any manual SQL:
 *   - marks every setup_progress step complete (creating rows if missing)
 *   - sets system_state.installation_complete = 'true'
 *
 * Idempotent: safe to run on every boot. Honors DB_PATH (single source of truth — must match
 * src/lib/db/index.ts; self-host uses /data/stdout.db).
 *
 * Windlass config is handled separately by create-windlass-config-from-env.js (needs the
 * Windlass health check), and scanner/observatory auto-start is handled by the app at runtime.
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';

// Must match src/lib/setup.ts SetupStep + STEP_NAMES exactly.
const STEPS = [
  [1, 'Create Admin Account'],
  [2, 'Name Environment'],
  [3, 'Activate License'],
  [4, 'Discover Infrastructure'],
  [5, 'Review Environment'],
  [6, 'Configure Windlass'],
  [7, 'Ticketing Integration'],
  [8, 'Complete'],
];

function main() {
  const db = new Database(DB_PATH);
  console.log(`[bootstrap] unattended bootstrap using DB: ${DB_PATH}`);

  const now = Date.now();

  const existing = db.prepare('SELECT step_number, completed FROM setup_progress').all();
  const byNum = new Map(existing.map((r) => [r.step_number, r]));

  const insert = db.prepare(
    `INSERT INTO setup_progress (id, step_number, step_name, completed, completed_at, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  );
  const markDone = db.prepare(
    `UPDATE setup_progress SET completed = 1, completed_at = ? WHERE step_number = ?`
  );

  const tx = db.transaction(() => {
    for (const [num, name] of STEPS) {
      if (!byNum.has(num)) {
        insert.run(nanoid(), num, name, now, now);
      } else if (!byNum.get(num).completed) {
        markDone.run(now, num);
      }
    }

    db.prepare(
      `INSERT INTO system_state (key, value, updated_at)
       VALUES ('installation_complete', 'true', ?)
       ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at`
    ).run(now);
  });
  tx();

  console.log('[bootstrap] ✓ all setup steps marked complete + installation_complete=true');
  db.close();
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error('[bootstrap] Error during unattended bootstrap:', err.message);
  process.exit(1);
}
