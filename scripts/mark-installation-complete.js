#!/usr/bin/env node
import Database from 'better-sqlite3';

try {
  const db = new Database('/data/central.db');

  db.prepare(`
    INSERT INTO system_state (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run('installation_complete', 'true', Date.now());

  console.log('✓ Installation marked complete');
  process.exit(0);
} catch (error) {
  console.error('Error marking installation complete:', error.message);
  process.exit(1);
}
