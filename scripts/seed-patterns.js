#!/usr/bin/env node
/**
 * seed-patterns.js — Seeds Observatory standard patterns into database
 * Run after migrations to populate stdlib patterns on fresh install
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
console.log(`[seed-patterns] Using database at: ${dbPath}`);

const db = new Database(dbPath);

try {
  // Check if stdlib patterns already exist
  const existing = db.prepare(
    "SELECT COUNT(*) AS n FROM observatory_standard_patterns WHERE source = 'stdlib'"
  ).get();

  if (existing && existing.n > 0) {
    console.log(`[seed-patterns] Stdlib patterns already seeded (${existing.n} patterns)`);
    db.close();
    process.exit(0);
  }

  // Find patterns JSON
  const candidates = [
    resolve(__dirname, 'standard-patterns.json'),
    resolve(__dirname, '../src/lib/observatory/standard-patterns.json'),
  ];

  let patternsPath = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      patternsPath = p;
      break;
    }
  }

  if (!patternsPath) {
    console.warn('[seed-patterns] standard-patterns.json not found — stdlib patterns not seeded');
    db.close();
    process.exit(0);
  }

  const patterns = JSON.parse(readFileSync(patternsPath, 'utf-8'));
  const now = Date.now();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO observatory_standard_patterns
      (id, pattern_name, category, symptoms, common_causes, resolution_steps,
       prevention_steps, confidence_threshold, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let n = 0;
  for (const p of patterns) {
    insert.run(
      p.id,
      p.pattern_name,
      p.category,
      JSON.stringify(p.symptoms),
      JSON.stringify(p.common_causes),
      JSON.stringify(p.resolution_steps),
      JSON.stringify(p.prevention_steps || []),
      p.confidence_threshold,
      p.source || 'stdlib',
      now,
      now
    );
    n++;
  }

  console.log(`[seed-patterns] Seeded ${n} stdlib standard patterns`);
} catch (error) {
  console.error('[seed-patterns] Failed:', error.message);
  process.exit(1);
}

db.close();
