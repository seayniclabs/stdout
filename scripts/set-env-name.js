#!/usr/bin/env node
import Database from 'better-sqlite3';

const [envName] = process.argv.slice(2);

if (!envName) {
  console.error('Usage: set-env-name.js <name>');
  process.exit(1);
}

try {
  const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
  const db = new Database(DB_PATH);

  db.prepare(`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run('environment_name', envName, Date.now());

  console.log(`✓ Environment name set: ${envName}`);
  db.close();
  process.exit(0);
} catch (error) {
  console.error('Error setting environment name:', error.message);
  process.exit(1);
}
