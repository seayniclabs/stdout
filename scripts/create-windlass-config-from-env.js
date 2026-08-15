#!/usr/bin/env node
/**
 * Create Windlass config from environment variables if it doesn't exist.
 * Called by init-setup.sh when WINDLASS_URL is set.
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
const WINDLASS_URL = process.env.WINDLASS_URL;

if (!WINDLASS_URL) {
  console.error('[create-windlass-config] WINDLASS_URL environment variable not set');
  process.exit(1);
}

try {
  const db = new Database(DB_PATH);

  // Get the admin user ID (first user)
  const user = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();

  if (!user) {
    console.log('[create-windlass-config] No users found — config will be created after first user is created');
    process.exit(0);
  }

  // Check if windlass_config already exists for this user
  const existing = db.prepare('SELECT id FROM windlass_config WHERE user_id = ?').get(user.id);

  if (existing) {
    console.log('[create-windlass-config] Windlass config already exists for user, skipping');
    process.exit(0);
  }

  // Create windlass_config record
  const now = Date.now();
  db.prepare(`
    INSERT INTO windlass_config (id, user_id, endpoint_url, sync_interval_seconds, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), user.id, WINDLASS_URL, 60, 1, now, now);

  console.log(`[create-windlass-config] ✓ Created Windlass config for user ${user.id}: ${WINDLASS_URL}`);
  db.close();
  process.exit(0);
} catch (error) {
  console.error('[create-windlass-config] Error:', error.message);
  process.exit(1);
}
