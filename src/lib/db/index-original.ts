import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema';

// Re-export schema for convenience
export { schema };

const DB_PATH = process.env.DB_PATH || './data/stdout.db';

let _db: BetterSQLite3Database<typeof schema> | null = null;

function initSqlite(dbPath: string): InstanceType<typeof Database> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Verify migrations have been run before allowing queries
  const migrationTable = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'
  `).get();

  if (!migrationTable) {
    console.error('\n❌ Database not initialized. Migrations required before startup.');
    console.error('   Run: npm run db:migrate');
    console.error('   Or: DB_PATH=./data/stdout.db npm run db:migrate\n');
    throw new Error('Database not initialized - run migrations first');
  }

  // Verify core tables exist (sanity check that migrations actually ran)
  const coreTablesExist = sqlite.prepare(`
    SELECT COUNT(*) as count FROM sqlite_master
    WHERE type='table' AND name IN ('users', 'incidents', 'monitors', 'stacks')
  `).get() as { count: number };

  if (coreTablesExist.count < 4) {
    console.error('\n❌ Database incomplete. Core tables missing.');
    console.error('   Expected: users, incidents, monitors, stacks');
    console.error('   Run: npm run db:migrate\n');
    throw new Error('Database schema incomplete - run migrations');
  }

  console.log('[DB] Migration check passed - all core tables present');

  // Verify schema matches expected columns (detects stale connections)
  const monitorsCols = sqlite.prepare('PRAGMA table_info(monitors)').all() as Array<{name: string}>;
  const hasFingerprint = monitorsCols.some(col => col.name === 'fingerprint');

  if (!hasFingerprint) {
    console.error('\n❌ Schema desync detected: monitors table missing fingerprint column');
    console.error('   Database has been migrated but connection is stale.');
    console.error('   Restart the dev server to pick up schema changes.\n');
    throw new Error('Schema desync - restart required after migrations');
  }

  console.log('[DB] Schema validation passed - fingerprint column present');
  return sqlite;
}

/**
 * Get the database connection.
 * For self-hosted deployments, there's only one database.
 * No multi-tenancy, no workspace switching - just a single DB.
 */
let _dbInitCount = 0;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    _dbInitCount++;
    console.log(`[DB INIT #${_dbInitCount}] Creating new database connection`);

    const sqlite = initSqlite(DB_PATH);

    // DEBUG: Log schema columns for monitors to verify fingerprint is in memory
    console.log('[DB DEBUG] monitors schema columns:', Object.keys(schema.monitors));

    _db = drizzle(sqlite, {
      schema,
      logger: process.env.NODE_ENV === 'development'
        ? {
            logQuery(query: string) {
              // Never log queries touching credentials, even in dev - query shape only, no params
              if (query.includes('token') || query.includes('sessions')) return;
              console.log('[DB QUERY]', query);
            }
          }
        : undefined
    });
    console.log('[DB] Drizzle instance created');
  } else {
    console.log(`[DB REUSE] Using existing connection (init #${_dbInitCount})`);
  }
  return _db;
}

/**
 * Get direct SQL

ite connection for migrations and raw queries.
 * Use sparingly - prefer Drizzle ORM via getDb().
 */
export function getSqlite(): InstanceType<typeof Database> {
  const db = getDb();
  return (db as any).$client;
}
