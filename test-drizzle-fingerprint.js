#!/usr/bin/env node
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from './src/lib/db/schema.js';

const sqlite = new Database('./data/stdout.db');
sqlite.pragma('journal_mode = WAL');

const db = drizzle(sqlite, { schema });

console.log('Testing Drizzle query for monitors with fingerprint...');

try {
  const result = db.select().from(schema.monitors).limit(1).all();
  console.log('✓ SUCCESS: Query executed');
  console.log('Result:', result);
} catch (error) {
  console.error('✗ FAILED:', error.message);
}

sqlite.close();
