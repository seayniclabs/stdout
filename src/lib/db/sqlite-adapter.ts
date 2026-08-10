/**
 * SQLite Database Adapter
 *
 * Implements DatabaseAdapter for SQLite using better-sqlite3 + Drizzle ORM.
 * Optimized for edge deployments, self-hosted instances, and SMB use cases.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';
import type { DatabaseAdapter, DatabaseConnection } from './adapter';
import * as schema from './schema';

export class SQLiteAdapter implements DatabaseAdapter {
  private dbPath: string;
  private sqlite: InstanceType<typeof Database> | null = null;
  private db: BetterSQLite3Database<typeof schema> | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  getType(): 'sqlite' {
    return 'sqlite';
  }

  connect(): DatabaseConnection {
    if (this.db) return this.db;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize SQLite with optimizations
    this.sqlite = new Database(this.dbPath);
    this.sqlite.pragma('journal_mode = WAL'); // Write-Ahead Logging for concurrency
    this.sqlite.pragma('foreign_keys = ON'); // Enforce referential integrity

    // Create Drizzle instance
    this.db = drizzle(this.sqlite, {
      schema,
      logger: process.env.NODE_ENV === 'development'
        ? {
            logQuery(query: string) {
              // Never log queries with sensitive data
              if (query.includes('token') || query.includes('sessions')) return;
              console.log('[SQLite]', query);
            }
          }
        : undefined
    });

    console.log(`[SQLite] Connected to ${this.dbPath}`);
    return this.db;
  }

  async migrate(): Promise<void> {
    if (!this.db || !this.sqlite) {
      throw new Error('Database not connected - call connect() first');
    }

    console.log('[SQLite] Running migrations...');

    // Drizzle migration runner
    await migrate(this.db, {
      migrationsFolder: './drizzle',
    });

    console.log('[SQLite] Migrations complete');
  }

  validate(): void {
    if (!this.sqlite) {
      throw new Error('Database not connected');
    }

    // Verify migrations table exists
    const migrationTable = this.sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'
    `).get();

    if (!migrationTable) {
      throw new Error(
        'Database not initialized. Run migrations: npm run db:migrate'
      );
    }

    // Verify core tables exist
    const coreTablesExist = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM sqlite_master
      WHERE type='table' AND name IN ('users', 'incidents', 'monitors', 'stacks', 'system_settings')
    `).get() as { count: number };

    if (coreTablesExist.count < 5) {
      throw new Error(
        'Database schema incomplete. Expected tables: users, incidents, monitors, stacks, system_settings'
      );
    }

    console.log('[SQLite] Validation passed - all core tables present');
  }

  disconnect(): void {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
      this.db = null;
      console.log('[SQLite] Connection closed');
    }
  }
}
