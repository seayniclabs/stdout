import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as centralSchema from './central-schema';
import * as tenantSchema from './tenant-schema';
import { seedDocs, SEED_VERSION } from './seed-community-docs';

// Re-export both schemas for convenience
export { centralSchema, tenantSchema };

// Backwards-compat: combined schema for self-host mode
const combinedSchema = { ...centralSchema, ...tenantSchema };

const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : './data';

const SELF_HOST = process.env.STDOUT_MODE !== 'saas';
const SINGLE_DB_PATH = process.env.DB_PATH || './data/stdout.db';

// --- Central DB (auth, billing, tokens, audit) ---

let _centralDb: BetterSQLite3Database<typeof centralSchema> | null = null;
let _selfHostDb: BetterSQLite3Database<typeof combinedSchema> | null = null;

function initSqlite(dbPath: string): InstanceType<typeof Database> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

function safeAddColumn(sqlite: InstanceType<typeof Database>, table: string, column: string, type: string): void {
  const cols = sqlite.pragma(`table_info(${table})`) as { name: string }[];
  if (!cols.some(c => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function runTenantMigrations(sqlite: InstanceType<typeof Database>): void {
  // Tenant-side column additions — idempotent, safe on every startup.
  // Community Knowledge Base (Phase 1)
  safeAddColumn(sqlite, 'docs', 'source', "TEXT NOT NULL DEFAULT 'user'");
  safeAddColumn(sqlite, 'docs', 'community_doc_id', 'TEXT');
  safeAddColumn(sqlite, 'docs', 'community_version', 'INTEGER');
  // Stack edit undo (2026-03-24)
  safeAddColumn(sqlite, 'stacks', 'previous_description', 'TEXT');
  // Onboarding progress (2026-03-25)
  safeAddColumn(sqlite, 'tenant_preferences', 'onboarding_progress', 'TEXT');
  safeAddColumn(sqlite, 'tenant_preferences', 'onboarding_dismissed', 'INTEGER NOT NULL DEFAULT 0');
  // Add-ons panel (2026-03-26)
  safeAddColumn(sqlite, 'tenant_preferences', 'addons_dismissed', 'INTEGER DEFAULT 0');
  safeAddColumn(sqlite, 'tenant_preferences', 'addons_hidden', 'INTEGER DEFAULT 0');
  safeAddColumn(sqlite, 'tenant_preferences', 'addons_cache', 'TEXT');
  safeAddColumn(sqlite, 'tenant_preferences', 'addons_cache_at', 'INTEGER');
  // Data sources: username/password columns (2026-03-28)
  safeAddColumn(sqlite, 'data_sources', 'username', 'TEXT');
  safeAddColumn(sqlite, 'data_sources', 'password', 'TEXT');
  // Windlass: manual override (2026-03-30)
  safeAddColumn(sqlite, 'windlass_services', 'override_until', 'INTEGER');
  safeAddColumn(sqlite, 'windlass_services', 'override_reason', 'TEXT');
  // Windlass: service decommissioning (2026-04-07)
  safeAddColumn(sqlite, 'windlass_services', 'decommissioned_at', 'INTEGER');
  // Windlass: preserve raw service type for assessment engine (2026-04-15)
  safeAddColumn(sqlite, 'windlass_services', 'service_type', "TEXT NOT NULL DEFAULT 'manual'");
  safeAddColumn(sqlite, 'windlass_services', 'usage_analytics', 'TEXT');
  safeAddColumn(sqlite, 'windlass_services', 'utilization_pct', 'INTEGER');
  safeAddColumn(sqlite, 'windlass_services', 'idle_hours_per_day', 'INTEGER');
  safeAddColumn(sqlite, 'windlass_services', 'scheduling_suggestion', 'TEXT');
  safeAddColumn(sqlite, 'windlass_config', 'last_weekly_digest_at', 'INTEGER');
  safeAddColumn(sqlite, 'windlass_config', 'n8n_workflow_windows_json', 'TEXT');
  safeAddColumn(sqlite, 'windlass_services', 'last_memory_shed_reason', 'TEXT');
  sqlite.exec(`
    UPDATE windlass_services
    SET service_type = CASE classification
      WHEN 'always_on' THEN 'always'
      WHEN 'scheduled' THEN 'schedule'
      WHEN 'on_demand' THEN 'on-demand'
      WHEN 'manual' THEN 'manual'
      ELSE 'manual'
    END
    WHERE service_type = 'manual';
  `);

  // Feature requests (2026-03-31)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS feature_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'feature',
      status TEXT NOT NULL DEFAULT 'submitted',
      admin_notes TEXT,
      response_to_user TEXT,
      votes INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feature_requests_user ON feature_requests(user_id);
  `);

  // Windlass: alert router tables (2026-03-30)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS alert_channels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service_id TEXT,
      channel_id TEXT NOT NULL,
      severity_min TEXT NOT NULL DEFAULT 'warning',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service_id TEXT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      suppressed INTEGER NOT NULL DEFAULT 0,
      suppression_reason TEXT,
      channels_notified TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_events_user ON alert_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_alert_events_service ON alert_events(service_id, created_at);
  `);
}

function seedCommunityDocs(sqlite: InstanceType<typeof Database>, userId: string): void {
  // Insert seed community docs if they don't already exist.
  // Uses INSERT OR IGNORE so re-runs are safe.
  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO docs (id, user_id, title, content, doc_type, tags, size_bytes, source, community_doc_id, community_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'community', ?, ?, ?, ?)
  `);
  const ftsStmt = sqlite.prepare(`
    INSERT OR IGNORE INTO docs_fts(rowid, title, content, tags)
    SELECT rowid, title, content, tags FROM docs WHERE id = ?
  `);

  const now = Date.now();
  for (const doc of seedDocs) {
    const sizeBytes = new TextEncoder().encode(doc.content).length;
    stmt.run(doc.id, userId, doc.title, doc.content, doc.docType, doc.tags, sizeBytes, doc.id, SEED_VERSION, now, now);
    try { ftsStmt.run(doc.id); } catch { /* FTS sync may fail if already indexed */ }
  }
}

function runMigrations(sqlite: InstanceType<typeof Database>): void {
  // Add columns that were added after initial schema creation.
  // Each migration is idempotent — safe to run on every startup.
  safeAddColumn(sqlite, 'users', 'privacy_accepted_at', 'INTEGER');
  safeAddColumn(sqlite, 'users', 'dpa_accepted_at', 'INTEGER');
  safeAddColumn(sqlite, 'stack_imports', 'user_id', 'TEXT');
  safeAddColumn(sqlite, 'users', 'subscription_tier', 'TEXT');
  safeAddColumn(sqlite, 'users', 'subscription_period_end', 'INTEGER');
  safeAddColumn(sqlite, 'users', 'oidc_sub', 'TEXT');

  // Team members table (RBAC for Shop tier)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'pending',
      invited_at INTEGER NOT NULL,
      accepted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_owner ON team_members(owner_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
  `);

  // Community Knowledge Base submissions (central DB)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS community_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_doc_id TEXT NOT NULL,
      sanitized_title TEXT NOT NULL,
      sanitized_content TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'note',
      tags TEXT,
      sanitization_log TEXT,
      value_score INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      review_notes TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      published_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_community_submissions_status ON community_submissions(status);
    CREATE INDEX IF NOT EXISTS idx_community_submissions_user ON community_submissions(user_id);
  `);
}

function runCentralDDL(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'none',
      role TEXT NOT NULL DEFAULT 'member',
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verified_at INTEGER,
      oidc_sub TEXT,
      stripe_customer_id TEXT,
      privacy_accepted_at INTEGER,
      dpa_accepted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deletions (
      id TEXT PRIMARY KEY,
      email_hash TEXT NOT NULL,
      deleted_at INTEGER NOT NULL
    );
  `);
}

function runTenantDDL(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stacks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      stack_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active',
      tags TEXT,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resolutions (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS diagnoses (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      root_causes TEXT NOT NULL,
      suggested_commands TEXT,
      matched_incident_ids TEXT,
      model TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenant_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_name TEXT,
      accent_color TEXT,
      logo_url TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      destination TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'note',
      incident_id TEXT,
      stack_id TEXT,
      tags TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stack_imports (
      id TEXT PRIMARY KEY,
      raw_json TEXT NOT NULL,
      rendered_markdown TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS status_page (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Service Status',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      monitor_ids TEXT NOT NULL,
      show_response_time INTEGER NOT NULL DEFAULT 1,
      show_uptime INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      target TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 60,
      timeout_ms INTEGER NOT NULL DEFAULT 5000,
      expected_status INTEGER,
      retries INTEGER NOT NULL DEFAULT 3,
      stack_id TEXT,
      paused INTEGER NOT NULL DEFAULT 0,
      maintenance INTEGER NOT NULL DEFAULT 0,
      current_status TEXT NOT NULL DEFAULT 'unknown',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_checked_at INTEGER,
      last_response_ms INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS check_results (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      status TEXT NOT NULL,
      response_time_ms INTEGER,
      status_code INTEGER,
      error TEXT,
      checked_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time ON check_results(monitor_id, checked_at);
    CREATE TABLE IF NOT EXISTS uptime_daily (
      monitor_id TEXT NOT NULL,
      date TEXT NOT NULL,
      total_checks INTEGER NOT NULL DEFAULT 0,
      successful_checks INTEGER NOT NULL DEFAULT 0,
      avg_response_ms INTEGER,
      p95_response_ms INTEGER,
      PRIMARY KEY (monitor_id, date)
    );
    CREATE TABLE IF NOT EXISTS scanner_schedule (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      interval TEXT NOT NULL DEFAULT 'daily',
      hour INTEGER NOT NULL DEFAULT 3,
      minute INTEGER NOT NULL DEFAULT 0,
      weekday INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      modules TEXT NOT NULL DEFAULT '["docker","metrics"]',
      subnets TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      token TEXT,
      username TEXT,
      password TEXT,
      org TEXT,
      bucket TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_tested_at INTEGER,
      last_test_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_data_sources_user ON data_sources(user_id);
    CREATE TABLE IF NOT EXISTS unknown_tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      reported INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS addon_interest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      notified INTEGER DEFAULT 0,
      UNIQUE(tool_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS ai_provider_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      diagnostics_model TEXT,
      autofix_model TEXT,
      platform_fallback INTEGER NOT NULL DEFAULT 1,
      last_validated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_user ON ai_provider_keys(user_id);
    CREATE TABLE IF NOT EXISTS ai_execution_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      incident_id TEXT,
      capability TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      credential_source TEXT NOT NULL,
      outcome TEXT NOT NULL,
      failure_reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_audit_user ON ai_execution_audit(user_id, created_at);
    CREATE TABLE IF NOT EXISTS windlass_services (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'manual',
      classification TEXT NOT NULL,
      compose_path TEXT,
      container_count INTEGER,
      memory_mb INTEGER,
      priority INTEGER NOT NULL DEFAULT 3,
      description TEXT,
      schedule_cron_start TEXT,
      schedule_cron_stop TEXT,
      runtime_window_start TEXT,
      runtime_window_end TEXT,
      current_state TEXT NOT NULL DEFAULT 'unknown',
      expected_state TEXT NOT NULL DEFAULT 'running',
      last_state_change INTEGER,
      last_started INTEGER,
      last_stopped INTEGER,
      containers TEXT,
      usage_analytics TEXT,
      utilization_pct INTEGER,
      idle_hours_per_day INTEGER,
      scheduling_suggestion TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_windlass_services_user ON windlass_services(user_id);
    CREATE TABLE IF NOT EXISTS windlass_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service_id TEXT,
      event_type TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_windlass_events_service ON windlass_events(service_id, created_at);
    CREATE TABLE IF NOT EXISTS windlass_config (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      sync_interval_seconds INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync_at INTEGER,
      last_sync_status TEXT,
      last_weekly_digest_at INTEGER,
      n8n_workflow_windows_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS incidents_fts USING fts5(
      title, description, tags,
      content='incidents',
      content_rowid='rowid'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS resolutions_fts USING fts5(
      content,
      content='resolutions',
      content_rowid='rowid'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      title, content, tags,
      content='docs',
      content_rowid='rowid'
    );
  `);
}

/**
 * Self-host: returns a single DB with all tables (central + tenant).
 * Used internally — prefer getCentralDb() or getTenantDb() in route handlers.
 */
function getSelfHostDb(): BetterSQLite3Database<typeof combinedSchema> {
  if (!_selfHostDb) {
    const sqlite = initSqlite(SINGLE_DB_PATH);
    runCentralDDL(sqlite);
    runTenantDDL(sqlite);
    runMigrations(sqlite);
    runTenantMigrations(sqlite);
    seedCommunityDocs(sqlite, 'system');
    _selfHostDb = drizzle(sqlite, { schema: combinedSchema });
  }
  return _selfHostDb;
}

/**
 * Get the central database (auth, billing, tokens, audit).
 * In self-host mode, returns the single combined DB.
 */
export function getCentralDb(): BetterSQLite3Database<typeof centralSchema> {
  if (SELF_HOST) return getSelfHostDb() as unknown as BetterSQLite3Database<typeof centralSchema>;

  if (!_centralDb) {
    const dbPath = path.join(DATA_DIR, 'central.db');
    const sqlite = initSqlite(dbPath);
    runCentralDDL(sqlite);
    runMigrations(sqlite);
    _centralDb = drizzle(sqlite, { schema: centralSchema });
  }
  return _centralDb;
}

// --- Tenant DB pool (LRU, max 50 connections) ---

const MAX_POOL_SIZE = 50;
const tenantPool = new Map<string, {
  db: BetterSQLite3Database<typeof tenantSchema>;
  lastAccess: number;
}>();

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of tenantPool) {
    if (entry.lastAccess < oldestTime) {
      oldestTime = entry.lastAccess;
      oldestKey = key;
    }
  }
  if (oldestKey) tenantPool.delete(oldestKey);
}

/**
 * Get a tenant's database (stacks, incidents, resolutions, diagnoses).
 * In self-host mode, returns the single combined DB.
 * Creates the tenant DB file + tables on first access.
 */
export function getTenantDb(userId: string): BetterSQLite3Database<typeof tenantSchema> {
  if (SELF_HOST) return getSelfHostDb() as unknown as BetterSQLite3Database<typeof tenantSchema>;

  const existing = tenantPool.get(userId);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing.db;
  }

  if (tenantPool.size >= MAX_POOL_SIZE) evictOldest();

  const tenantsDir = path.join(DATA_DIR, 'tenants');
  const dbPath = path.join(tenantsDir, `${userId}.db`);
  const sqlite = initSqlite(dbPath);
  runTenantDDL(sqlite);
  runTenantMigrations(sqlite);
  seedCommunityDocs(sqlite, userId);

  const db = drizzle(sqlite, { schema: tenantSchema });
  tenantPool.set(userId, { db, lastAccess: Date.now() });
  return db;
}

/**
 * Remove a tenant's DB connection from the pool.
 * Call before deleting the tenant DB file.
 */
export function evictTenantDb(userId: string): void {
  tenantPool.delete(userId);
}

