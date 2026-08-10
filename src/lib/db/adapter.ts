/**
 * Database Adapter Interface
 *
 * Abstraction layer for supporting both SQLite (edge/SMB) and PostgreSQL (scale).
 * Application code remains database-agnostic - switching engines requires only
 * environment variable changes, zero code modifications.
 *
 * Design Philosophy:
 * - Same codebase, multiple backends
 * - Runtime detection via DATABASE_TYPE env var
 * - Drizzle ORM provides most abstraction, adapters handle engine-specific setup
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

/**
 * Database configuration types
 */
export type DbConfig =
  | { type: 'sqlite'; path: string }
  | { type: 'postgres'; connectionString: string };

/**
 * Unified database type that works with both SQLite and PostgreSQL
 * Drizzle provides query builder compatibility across engines
 */
export type DatabaseConnection =
  | BetterSQLite3Database<typeof schema>
  | PostgresJsDatabase<typeof schema>;

/**
 * Adapter interface for database-specific initialization and cleanup
 */
export interface DatabaseAdapter {
  /**
   * Initialize database connection and run validation checks
   */
  connect(): Promise<DatabaseConnection> | DatabaseConnection;

  /**
   * Close database connection gracefully
   */
  disconnect(): Promise<void> | void;

  /**
   * Run database migrations (implementation-specific)
   */
  migrate(): Promise<void>;

  /**
   * Verify schema integrity (tables exist, critical columns present)
   */
  validate(): Promise<void> | void;

  /**
   * Get database type identifier
   */
  getType(): 'sqlite' | 'postgres';
}

/**
 * Parse database configuration from environment variables
 */
export function getDbConfig(): DbConfig {
  const dbType = process.env.DATABASE_TYPE || 'sqlite';

  if (dbType === 'postgres') {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL required when DATABASE_TYPE=postgres');
    }
    return { type: 'postgres', connectionString };
  }

  // Default to SQLite
  const dbPath = process.env.DB_PATH || './data/stdout.db';
  return { type: 'sqlite', path: dbPath };
}

/**
 * Factory function to create appropriate database adapter
 */
export async function createAdapter(config: DbConfig): Promise<DatabaseAdapter> {
  if (config.type === 'postgres') {
    const { PostgresAdapter } = await import('./postgres-adapter');
    return new PostgresAdapter(config.connectionString);
  } else {
    const { SQLiteAdapter } = await import('./sqlite-adapter');
    return new SQLiteAdapter(config.path);
  }
}

/**
 * Singleton database connection
 * Initialized once, reused throughout application lifecycle
 */
let _adapter: DatabaseAdapter | null = null;
let _db: DatabaseConnection | null = null;

/**
 * Get database connection (initializes on first call)
 */
export async function getDb(): Promise<DatabaseConnection> {
  if (!_db || !_adapter) {
    const config = getDbConfig();
    console.log(`[DB] Initializing ${config.type} database...`);

    _adapter = await createAdapter(config);
    _db = await _adapter.connect();

    console.log(`[DB] ${config.type} connection established`);
  }

  return _db;
}

/**
 * Close database connection (for graceful shutdown)
 */
export async function closeDb(): Promise<void> {
  if (_adapter) {
    await _adapter.disconnect();
    _adapter = null;
    _db = null;
    console.log('[DB] Connection closed');
  }
}
