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
  return sqlite;
}

/**
 * Get the database connection.
 * For self-hosted deployments, there's only one database.
 * No multi-tenancy, no workspace switching - just a single DB.
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    const sqlite = initSqlite(DB_PATH);
    _db = drizzle(sqlite, {
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          console.log('[SQL]', query);
          console.log('[SQL PARAMS]', params);
        }
      }
    });
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
