/**
 * PostgreSQL Database Adapter
 *
 * Implements DatabaseAdapter for PostgreSQL using postgres.js + Drizzle ORM.
 * Optimized for scaling deployments with high transaction volumes.
 */

import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { DatabaseAdapter, DatabaseConnection } from './adapter';
import * as schema from './schema';

export class PostgresAdapter implements DatabaseAdapter {
  private connectionString: string;
  private sql: ReturnType<typeof postgres> | null = null;
  private db: PostgresJsDatabase<typeof schema> | null = null;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  getType(): 'postgres' {
    return 'postgres';
  }

  async connect(): Promise<DatabaseConnection> {
    if (this.db) return this.db;

    // Initialize postgres.js connection
    this.sql = postgres(this.connectionString, {
      max: 10, // Connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    });

    // Create Drizzle instance
    this.db = drizzle(this.sql, {
      schema,
      logger: process.env.NODE_ENV === 'development'
        ? {
            logQuery(query: string) {
              // Never log queries with sensitive data
              if (query.includes('token') || query.includes('sessions')) return;
              console.log('[PostgreSQL]', query);
            }
          }
        : undefined
    });

    console.log('[PostgreSQL] Connected');
    return this.db;
  }

  async migrate(): Promise<void> {
    if (!this.db || !this.sql) {
      throw new Error('Database not connected - call connect() first');
    }

    console.log('[PostgreSQL] Running migrations...');

    // Drizzle migration runner
    await migrate(this.db, {
      migrationsFolder: './drizzle',
    });

    console.log('[PostgreSQL] Migrations complete');
  }

  async validate(): Promise<void> {
    if (!this.sql) {
      throw new Error('Database not connected');
    }

    // Verify migrations table exists
    const migrationTable = await this.sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = '__drizzle_migrations'
    `;

    if (migrationTable.length === 0) {
      throw new Error(
        'Database not initialized. Run migrations: npm run db:migrate'
      );
    }

    // Verify core tables exist
    const coreTables = await this.sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('users', 'incidents', 'monitors', 'stacks', 'system_settings')
    `;

    if (coreTables.length < 5) {
      throw new Error(
        'Database schema incomplete. Expected tables: users, incidents, monitors, stacks, system_settings'
      );
    }

    console.log('[PostgreSQL] Validation passed - all core tables present');
  }

  async disconnect(): Promise<void> {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
      this.db = null;
      console.log('[PostgreSQL] Connection closed');
    }
  }
}
