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

  // Run skins tables migration if tables don't exist
  // This ensures the skins feature works even if migrations weren't run
  const tablesExist = sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='skins'
  `).get();

  if (!tablesExist) {
    console.log('[DB] Creating skins tables...');
    sqlite.exec(`
      -- Create skins table
      CREATE TABLE IF NOT EXISTS skins (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        author TEXT,
        version TEXT NOT NULL DEFAULT '1.0.0',
        is_built_in INTEGER NOT NULL DEFAULT 0,
        is_public INTEGER NOT NULL DEFAULT 0,
        colors TEXT NOT NULL,
        typography TEXT,
        spacing TEXT,
        shadows TEXT,
        effects TEXT,
        thumbnail TEXT,
        tags TEXT,
        install_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Create user_skin_preferences table
      CREATE TABLE IF NOT EXISTS user_skin_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        active_skin_id TEXT REFERENCES skins(id) ON DELETE SET NULL,
        custom_overrides TEXT,
        updated_at INTEGER NOT NULL
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_skins_user_id ON skins(user_id);
      CREATE INDEX IF NOT EXISTS idx_skins_is_built_in ON skins(is_built_in);
    `);
    console.log('[DB] Skins tables created');
  }

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
