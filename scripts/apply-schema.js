#!/usr/bin/env node
/**
 * apply-schema.js — creates all tables on a fresh database.
 * Schema must exactly match the Drizzle DDL in src/lib/db/index.ts.
 * The app runs its own DDL on startup (CREATE TABLE IF NOT EXISTS),
 * so this script is additive: it pre-creates tables the installer
 * needs before the app starts.
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const dbPath = process.env.DATABASE_PATH || process.env.DB_PATH || '/data/central.db';
console.log(`[apply-schema] Using database at: ${dbPath}`);

const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('[apply-schema] Creating schema tables...');

// ── Central tables (runCentralDDL) ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    email_verified INTEGER NOT NULL DEFAULT 0,
    email_verified_at INTEGER,
    privacy_accepted_at INTEGER,
    dpa_accepted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS license (
    key TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    edition TEXT NOT NULL DEFAULT 'self-host',
    activated_at INTEGER NOT NULL,
    last_checked_at INTEGER
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

// ── Tenant tables (runTenantDDL) ──────────────────────────────────────────────
db.exec(`
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

// ── Migration tables (runMigrations) ──────────────────────────────────────────
db.exec(`
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
  CREATE TABLE IF NOT EXISTS discovered_hosts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ip_address TEXT NOT NULL UNIQUE,
    hostname TEXT,
    mac_address TEXT,
    vendor TEXT,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discovered_services (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'tcp',
    service_name TEXT,
    service_version TEXT,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_discovered_hosts_user ON discovered_hosts(user_id, last_seen);
  CREATE INDEX IF NOT EXISTS idx_discovered_services_host ON discovered_services(host_id, last_seen);
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

// Additional columns added by safeAddColumn migrations — applied here so
// the schema is fully up to date before the app starts.
const safeAddColumn = (table, col, type) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  } catch {
    // Column already exists — safe to ignore
  }
};

safeAddColumn('users', 'subscription_tier', 'TEXT');
safeAddColumn('users', 'subscription_period_end', 'INTEGER');
safeAddColumn('users', 'oidc_sub', 'TEXT');
safeAddColumn('stack_imports', 'user_id', 'TEXT');
safeAddColumn('windlass_services', 'override_until', 'INTEGER');
safeAddColumn('windlass_services', 'override_reason', 'TEXT');
safeAddColumn('windlass_services', 'decommissioned_at', 'INTEGER');
safeAddColumn('windlass_services', 'last_memory_shed_reason', 'TEXT');
safeAddColumn('windlass_services', 'service_type', "TEXT NOT NULL DEFAULT 'manual'");
safeAddColumn('windlass_services', 'usage_analytics', 'TEXT');
safeAddColumn('windlass_services', 'utilization_pct', 'INTEGER');
safeAddColumn('windlass_services', 'idle_hours_per_day', 'INTEGER');
safeAddColumn('windlass_services', 'scheduling_suggestion', 'TEXT');
safeAddColumn('docs', 'source', "TEXT DEFAULT 'user'");
safeAddColumn('docs', 'community_doc_id', 'TEXT');
safeAddColumn('docs', 'community_version', 'INTEGER');
safeAddColumn('tenant_preferences', 'onboarding_progress', 'TEXT');
safeAddColumn('tenant_preferences', 'onboarding_dismissed', 'INTEGER');
safeAddColumn('tenant_preferences', 'addons_dismissed', 'INTEGER');
safeAddColumn('tenant_preferences', 'addons_hidden', 'INTEGER');
safeAddColumn('tenant_preferences', 'addons_cache', 'TEXT');
safeAddColumn('tenant_preferences', 'addons_cache_at', 'INTEGER');
safeAddColumn('discovered_hosts', 'stack_id', 'TEXT');
safeAddColumn('stacks', 'previous_description', 'TEXT');
safeAddColumn('data_sources', 'username', 'TEXT');
safeAddColumn('data_sources', 'password', 'TEXT');
safeAddColumn('windlass_config', 'last_weekly_digest_at', 'INTEGER');
safeAddColumn('windlass_config', 'n8n_workflow_windows_json', 'TEXT');

// ── Tables added after initial schema (not in original DDL) ──────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'incident',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    stack_id TEXT,
    severity TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    tags TEXT,
    external_system TEXT,
    external_id TEXT,
    external_url TEXT,
    last_synced_at INTEGER,
    sync_direction TEXT,
    sync_status TEXT,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
  CREATE TABLE IF NOT EXISTS ticketing_connectors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    system TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_primary INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL,
    sync_enabled INTEGER NOT NULL DEFAULT 1,
    sync_interval INTEGER NOT NULL DEFAULT 300,
    last_sync_at INTEGER,
    last_sync_status TEXT,
    field_mappings TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ticketing_connectors_user ON ticketing_connectors(user_id);
  CREATE TABLE IF NOT EXISTS doc_embeddings (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    embedding TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_doc_embeddings_doc ON doc_embeddings(doc_id);
  CREATE TABLE IF NOT EXISTS setup_progress (
    id TEXT PRIMARY KEY,
    step_number INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER,
    data TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS setup_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

console.log('[apply-schema] Schema applied successfully');
db.close();
