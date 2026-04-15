#!/usr/bin/env node
/**
 * Adds windlass_services.service_type to existing StdOut databases.
 *
 * Usage:
 *   node scripts/migrate-windlass-service-type.js
 *   DATA_DIR=/custom/path node scripts/migrate-windlass-service-type.js
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function migrateDb(dbPath) {
  if (!fs.existsSync(dbPath)) return { dbPath, skipped: true, reason: 'missing file' };

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const hasTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='windlass_services' LIMIT 1"
  ).get();
  if (!hasTable) {
    db.close();
    return { dbPath, skipped: true, reason: 'windlass_services table not found' };
  }

  const cols = db.prepare('PRAGMA table_info(windlass_services)').all();
  const hasColumn = cols.some((col) => col.name === 'service_type');
  if (!hasColumn) {
    db.exec("ALTER TABLE windlass_services ADD COLUMN service_type TEXT NOT NULL DEFAULT 'manual'");
  }

  const result = db.prepare(`
    UPDATE windlass_services
    SET service_type = CASE classification
      WHEN 'always_on' THEN 'always'
      WHEN 'scheduled' THEN 'schedule'
      WHEN 'on_demand' THEN 'on-demand'
      WHEN 'manual' THEN 'manual'
      ELSE 'manual'
    END
    WHERE service_type = 'manual';
  `).run();

  const total = db.prepare('SELECT COUNT(*) as count FROM windlass_services').get().count;
  db.close();

  return {
    dbPath,
    skipped: false,
    addedColumn: !hasColumn,
    rowsBackfilled: result.changes,
    totalRows: total,
  };
}

function run() {
  const targets = [];
  const selfHostDb = path.join(DATA_DIR, 'stdout.db');
  targets.push(selfHostDb);

  const tenantsDir = path.join(DATA_DIR, 'tenants');
  if (fs.existsSync(tenantsDir)) {
    const tenantDbs = fs.readdirSync(tenantsDir)
      .filter((name) => name.endsWith('.db'))
      .map((name) => path.join(tenantsDir, name));
    targets.push(...tenantDbs);
  }

  if (targets.length === 0) {
    console.log('No database files found to migrate.');
    process.exit(0);
  }

  console.log(`Migrating service_type in ${targets.length} database(s)...`);
  for (const dbPath of targets) {
    const result = migrateDb(dbPath);
    if (result.skipped) {
      console.log(`- ${dbPath}: skipped (${result.reason})`);
      continue;
    }
    const added = result.addedColumn ? 'added column' : 'column exists';
    console.log(`- ${dbPath}: ${added}, backfilled ${result.rowsBackfilled}/${result.totalRows} row(s)`);
  }
}

run();
