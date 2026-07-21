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

  // Create collector_configs + data_source_events tables if missing (migration 0014)
  const collectorConfigsExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='collector_configs'
  `).get();
  if (!collectorConfigsExists) {
    console.log('[DB] Creating collector tables...');
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS collector_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cc_type ON collector_configs(type);
      CREATE INDEX IF NOT EXISTS idx_cc_enabled ON collector_configs(enabled);

      CREATE TABLE IF NOT EXISTS data_source_events (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        type TEXT NOT NULL,
        attributes TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source_id TEXT,
        source_type TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dse_entity_type_ts ON data_source_events(entity, type, timestamp);
      CREATE INDEX IF NOT EXISTS idx_dse_timestamp ON data_source_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_dse_source_id ON data_source_events(source_id);
    `);
    console.log('[DB] Collector tables created');
  }

  // Create resolutions FTS table if missing
  const resFtsExists = sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='resolutions_fts'
  `).get();

  if (!resFtsExists) {
    console.log('[DB] Creating resolutions_fts table...');
    sqlite.exec(`
      -- Create FTS table for resolutions search
      CREATE VIRTUAL TABLE IF NOT EXISTS resolutions_fts USING fts5(
        content,
        content='resolutions',
        content_rowid='rowid'
      );

      -- Populate existing resolutions into FTS
      INSERT INTO resolutions_fts(rowid, content)
      SELECT rowid, content FROM resolutions;
    `);
    console.log('[DB] resolutions_fts table created');
  }

  // Add cost tracking columns to incidents if missing (migration 0015)
  const aiCostColumnExists = sqlite.prepare(`
    PRAGMA table_info(incidents)
  `).all() as any[];

  const hasAiCostColumn = aiCostColumnExists.some((col) => col.name === 'ai_cost_usd');
  if (!hasAiCostColumn) {
    console.log('[DB] Adding cost tracking columns to incidents...');
    sqlite.exec(`
      ALTER TABLE incidents ADD COLUMN ai_cost_usd REAL NOT NULL DEFAULT 0;
      ALTER TABLE incidents ADD COLUMN ai_tokens_used INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE incidents ADD COLUMN ai_provider TEXT;
    `);
    console.log('[DB] Cost tracking columns added');
  }

  // Create remediation playbooks table if missing
  const pbExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='remediation_playbooks'
  `).get();

  if (!pbExists) {
    console.log('[DB] Creating auto-remediation tables...');
    sqlite.exec(`
      CREATE TABLE remediation_playbooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        trigger TEXT NOT NULL,
        steps TEXT NOT NULL,
        rollback TEXT NOT NULL,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        timeout INTEGER NOT NULL,
        risk_level TEXT NOT NULL DEFAULT 'medium',
        tags TEXT NOT NULL DEFAULT '[]',
        is_built_in INTEGER NOT NULL DEFAULT 0,
        version TEXT NOT NULL DEFAULT '1.0.0',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_by TEXT
      );

      CREATE INDEX idx_rp_user_id ON remediation_playbooks(user_id);
      CREATE INDEX idx_rp_is_built_in ON remediation_playbooks(is_built_in);

      CREATE TABLE remediation_executions (
        id TEXT PRIMARY KEY,
        playbook_id TEXT NOT NULL REFERENCES remediation_playbooks(id),
        incident_id TEXT NOT NULL REFERENCES incidents(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        dry_run INTEGER NOT NULL DEFAULT 0,
        approved_by TEXT,
        approved_at INTEGER,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        logs TEXT NOT NULL DEFAULT '[]',
        rollback_attempted INTEGER NOT NULL DEFAULT 0,
        rollback_success INTEGER
      );

      CREATE INDEX idx_re_user_id ON remediation_executions(user_id);
      CREATE INDEX idx_re_incident_id ON remediation_executions(incident_id);
      CREATE INDEX idx_re_playbook_id ON remediation_executions(playbook_id);
      CREATE INDEX idx_re_status ON remediation_executions(status);

      CREATE TABLE remediation_execution_steps (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES remediation_executions(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        output TEXT,
        error_message TEXT,
        duration_ms INTEGER,
        retries_used INTEGER NOT NULL DEFAULT 0,
        executed_at INTEGER
      );

      CREATE INDEX idx_res_execution_id ON remediation_execution_steps(execution_id);

      CREATE TABLE cost_audit (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL REFERENCES incidents(id),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_ca_incident_id ON cost_audit(incident_id);
      CREATE INDEX idx_ca_provider ON cost_audit(provider);
      CREATE INDEX idx_ca_created_at ON cost_audit(created_at);
    `);
    console.log('[DB] Auto-remediation and cost tracking tables created');
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
