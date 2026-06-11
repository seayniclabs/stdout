#!/usr/bin/env node
import Database from 'better-sqlite3';

try {
  const db = new Database('/data/central.db');

  db.prepare(`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run('installation_complete', 'true', Date.now());

  console.log('✓ Installation marked complete');
  process.exit(0);
} catch (error) {
  console.error('Error marking installation complete:', error.message);
  process.exit(1);
}
