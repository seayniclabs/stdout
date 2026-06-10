/**
 * Seed Observatory Standard Patterns
 *
 * This migration loads the standard incident pattern library that ships
 * with every StdOut installation. These patterns provide baseline knowledge
 * for the Observatory AI agents.
 *
 * Run on: Fresh install, or when updating pattern library version
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load standard patterns from JSON
const patternsPath = join(__dirname, '../src/lib/observatory/standard-patterns.json');
const standardPatterns = JSON.parse(readFileSync(patternsPath, 'utf-8'));

console.log(`📚 Loading ${standardPatterns.length} standard patterns...`);

// Get database path from environment or use default
const dbPath = process.env.DB_PATH || './data/stdout.db';
const db = new Database(dbPath);

// Ensure we have the patterns table (in case migration 0010 hasn't run)
db.exec(`
  CREATE TABLE IF NOT EXISTS observatory_standard_patterns (
    id TEXT PRIMARY KEY,
    pattern_name TEXT NOT NULL,
    category TEXT NOT NULL,
    symptoms TEXT NOT NULL,
    common_causes TEXT NOT NULL,
    resolution_steps TEXT NOT NULL,
    prevention_steps TEXT,
    confidence_threshold REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'stdlib',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Clear existing stdlib patterns (in case of re-seeding)
const deleted = db.prepare('DELETE FROM observatory_standard_patterns WHERE source = ?').run('stdlib');
console.log(`🗑️  Removed ${deleted.changes} existing stdlib patterns`);

// Insert patterns
const insert = db.prepare(`
  INSERT INTO observatory_standard_patterns (
    id, pattern_name, category, symptoms, common_causes, resolution_steps,
    prevention_steps, confidence_threshold, source, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const now = Date.now();
let inserted = 0;

for (const pattern of standardPatterns) {
  insert.run(
    pattern.id,
    pattern.pattern_name,
    pattern.category,
    JSON.stringify(pattern.symptoms),
    JSON.stringify(pattern.common_causes),
    JSON.stringify(pattern.resolution_steps),
    JSON.stringify(pattern.prevention_steps || []),
    pattern.confidence_threshold,
    pattern.source,
    now,
    now
  );
  inserted++;
}

console.log(`✅ Seeded ${inserted} standard patterns`);

// Verify
const count = db.prepare('SELECT COUNT(*) as count FROM observatory_standard_patterns WHERE source = ?').get('stdlib');
console.log(`📊 Total stdlib patterns in database: ${count.count}`);

// Show category breakdown
const categories = db.prepare(`
  SELECT category, COUNT(*) as count
  FROM observatory_standard_patterns
  WHERE source = 'stdlib'
  GROUP BY category
  ORDER BY count DESC
`).all();

console.log('\n📁 Pattern Categories:');
categories.forEach((cat) => {
  console.log(`  ${cat.category}: ${cat.count} patterns`);
});

db.close();

console.log('\n✅ Observatory pattern library seeded successfully!');
