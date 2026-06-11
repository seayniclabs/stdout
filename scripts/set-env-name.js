#!/usr/bin/env node
import Database from 'better-sqlite3';

const [envName] = process.argv.slice(2);

if (!envName) {
  console.error('Usage: set-env-name.js <name>');
  process.exit(1);
}

try {
  const db = new Database('/data/central.db');

  db.prepare(`
    INSERT INTO system_state (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updatedAt = excluded.updatedAt
  `).run('environment_name', envName, Date.now());

  console.log(`✓ Environment name set: ${envName}`);
  db.close();
  process.exit(0);
} catch (error) {
  console.error('Error setting environment name:', error.message);
  process.exit(1);
}
