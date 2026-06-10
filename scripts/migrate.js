#!/usr/bin/env node
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

// Use DB_PATH (Docker env var) or DATABASE_PATH, fallback to volume mount path
const dbPath = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
console.log(`[migrate] Using database at: ${dbPath}`);

// Ensure directory exists
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);

console.log('Running database migrations...');

// Create setup_progress table
db.exec(`
  CREATE TABLE IF NOT EXISTS setup_progress (
    id TEXT PRIMARY KEY,
    step_number INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER,
    data TEXT,
    created_at INTEGER NOT NULL
  );
`);

// Create setup_config table
db.exec(`
  CREATE TABLE IF NOT EXISTS setup_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

console.log('✓ Database migrations complete');
db.close();
