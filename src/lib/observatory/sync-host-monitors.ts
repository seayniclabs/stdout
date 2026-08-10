/**
 * Sync Monitors for Discovered Hosts
 * Creates ping monitors for all discovered hosts that don't already have monitors
 */

import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export function syncHostMonitors(db: Database, _userId?: string): { created: number; updated: number } {
  let created = 0;
  let updated = 0;

  // Get all discovered hosts
  const hosts = db.prepare(`
    SELECT id, ip_address, hostname, stack_id
    FROM discovered_hosts
  `).all() as Array<{ id: string; ip_address: string; hostname: string | null; stack_id: string | null }>;

  for (const host of hosts) {
    const name = host.hostname || host.ip_address;
    const target = host.ip_address;

    // Check if monitor already exists for this host
    const existing = db.prepare(`
      SELECT id FROM monitors
      WHERE target = ?
      LIMIT 1
    `).get(target) as { id: string } | undefined;

    const now = new Date().toISOString();

    if (existing) {
      // Update hostname if it changed
      db.prepare(`
        UPDATE monitors
        SET name = ?,
            updated_at = ?
        WHERE id = ?
      `).run(name, now, existing.id);
      updated++;
    } else {
      // Create new ping monitor
      db.prepare(`
        INSERT INTO monitors (
          id, name, type, target, interval_seconds, timeout_ms,
          expected_status, retries, stack_id, paused, maintenance,
          current_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'unknown', ?, ?)
      `).run(
        nanoid(),
        name,
        'ping',
        target,
        60, // 60s interval for host monitoring
        2000, // 2s timeout for ping
        null,
        3, // 3 retries
        host.stack_id,
        now,
        now
      );
      created++;
    }
  }

  return { created, updated };
}
