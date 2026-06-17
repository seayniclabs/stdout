#!/usr/bin/env node
/**
 * migrate.js — Drizzle migration runner
 * Applies schema migrations from drizzle/ folder to the SQLite database
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// DB_PATH is the single source of truth
const dbPath = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
console.log(`[migrate] Using database at: ${dbPath}`);

const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite);

console.log('[migrate] Running database migrations...');

try {
  migrate(db, { migrationsFolder: join(__dirname, '../drizzle') });
  console.log('✓ Database migrations complete');
} catch (error) {
  console.error('[migrate] Migration failed:', error.message);
  process.exit(1);
}

sqlite.close();
