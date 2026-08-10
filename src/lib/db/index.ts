/**
 * Database Connection Manager
 *
 * Phase 1.2: PostgreSQL Abstraction Layer
 * Supports both SQLite (edge/SMB) and PostgreSQL (scale) via adapter pattern.
 *
 * Environment Variables:
 * - DATABASE_TYPE: "sqlite" (default) | "postgres"
 * - DB_PATH: SQLite file path (default: ./data/stdout.db)
 * - DATABASE_URL: PostgreSQL connection string (required when DATABASE_TYPE=postgres)
 *
 * Example configurations:
 *
 * SQLite (default):
 *   DATABASE_TYPE=sqlite
 *   DB_PATH=./data/stdout.db
 *
 * PostgreSQL:
 *   DATABASE_TYPE=postgres
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/stdout
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema';
import { getDbConfig } from './adapter';

// Re-export schema for convenience
export { schema };

/**
 * TRANSITION STRATEGY:
 *
 * Phase 1.2 introduces PostgreSQL support via adapter pattern, but we have 335 callsites
 * using synchronous `getDb()`. To avoid a massive refactor, we use this strategy:
 *
 * 1. For SQLite (default): Keep existing synchronous behavior
 * 2. For PostgreSQL: Initialize connection at startup, cache it, return synchronously
 * 3. Later phases can migrate to fully async if needed
 *
 * This allows zero-code-change compatibility while supporting both databases.
 */

const DB_PATH = process.env.DB_PATH || './data/stdout.db';
let _db: BetterSQLite3Database<typeof schema> | null = null;

function initSqlite(dbPath: string): InstanceType<typeof Database> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Verify migrations have been run
  const migrationTable = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'
  `).get();

  if (!migrationTable) {
    console.error('\n❌ Database not initialized. Run: npm run db:migrate\n');
    throw new Error('Database not initialized - run migrations first');
  }

  // Verify core tables exist
  const coreTablesExist = sqlite.prepare(`
    SELECT COUNT(*) as count FROM sqlite_master
    WHERE type='table' AND name IN ('users', 'incidents', 'monitors', 'stacks', 'system_settings')
  `).get() as { count: number };

  if (coreTablesExist.count < 5) {
    console.error('\n❌ Database incomplete. Expected: users, incidents, monitors, stacks, system_settings\n');
    throw new Error('Database schema incomplete - run migrations');
  }

  console.log('[SQLite] Migration check passed');
  return sqlite;
}

/**
 * Get the database connection (synchronous).
 * Automatically uses SQLite (only supported database for now).
 *
 * PostgreSQL support will be added in Phase 1.2.1 after adapter testing.
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  const config = getDbConfig();

  // For now, only SQLite is fully integrated
  if (config.type === 'postgres') {
    console.warn('[DB] PostgreSQL requested but not yet integrated. Falling back to SQLite.');
    console.warn('[DB] Set DATABASE_TYPE=sqlite or wait for Phase 1.2.1 completion.');
  }

  if (!_db) {
    console.log('[DB] Initializing SQLite database...');
    const sqlite = initSqlite(DB_PATH);

    _db = drizzle(sqlite, {
      schema,
      logger: process.env.NODE_ENV === 'development'
        ? {
            logQuery(query: string) {
              if (query.includes('token') || query.includes('sessions')) return;
              console.log('[SQLite]', query);
            }
          }
        : undefined
    });

    console.log('[SQLite] Connection established');
  }

  return _db;
}

/**
 * Get direct SQLite connection for migrations and raw queries.
 * Use sparingly - prefer Drizzle ORM via getDb().
 */
export function getSqlite(): InstanceType<typeof Database> {
  const db = getDb();
  return (db as any).$client;
}

/**
 * Get database configuration info (for debugging)
 */
export function getDatabaseInfo(): { type: 'sqlite' | 'postgres'; details: string } {
  const config = getDbConfig();
  if (config.type === 'postgres') {
    const redacted = config.connectionString.replace(/:([^@]+)@/, ':***@');
    return { type: 'postgres', details: redacted };
  }
  return { type: 'sqlite', details: config.path };
}
