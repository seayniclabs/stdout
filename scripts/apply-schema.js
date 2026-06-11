#!/usr/bin/env node
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

// Column names must match Drizzle central-schema.ts exactly (snake_case)
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

  CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS license (
    key TEXT PRIMARY KEY,
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
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
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

  CREATE TABLE IF NOT EXISTS stacks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    previous_description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stack_id TEXT REFERENCES stacks(id),
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    tags TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS resolutions (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS diagnoses (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    root_causes TEXT,
    suggested_commands TEXT,
    matched_incident_ids TEXT,
    model TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'note',
    incident_id TEXT REFERENCES incidents(id),
    stack_id TEXT REFERENCES stacks(id),
    tags TEXT,
    size_bytes INTEGER,
    source TEXT DEFAULT 'user',
    community_doc_id TEXT,
    community_version INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tenant_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    workspace_name TEXT,
    accent_color TEXT,
    logo_url TEXT,
    onboarding_progress TEXT,
    onboarding_dismissed INTEGER,
    addons_dismissed INTEGER,
    addons_hidden INTEGER,
    addons_cache TEXT,
    addons_cache_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    events TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stack_imports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raw_json TEXT,
    rendered_markdown TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_page (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    monitor_ids TEXT,
    show_response_time INTEGER NOT NULL DEFAULT 1,
    show_uptime INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stack_id TEXT REFERENCES stacks(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'http',
    target TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 300,
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    expected_status INTEGER,
    retries INTEGER NOT NULL DEFAULT 1,
    paused INTEGER NOT NULL DEFAULT 0,
    maintenance INTEGER NOT NULL DEFAULT 0,
    current_status TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_checked_at INTEGER,
    last_response_ms INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS check_results (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    response_time_ms INTEGER,
    status_code INTEGER,
    error TEXT,
    checked_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uptime_daily (
    monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    total_checks INTEGER NOT NULL DEFAULT 0,
    successful_checks INTEGER NOT NULL DEFAULT 0,
    avg_response_ms INTEGER,
    p95_response_ms INTEGER,
    PRIMARY KEY (monitor_id, date)
  );

  CREATE TABLE IF NOT EXISTS scanner_schedule (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interval TEXT NOT NULL DEFAULT 'daily',
    hour INTEGER,
    minute INTEGER,
    weekday TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    modules TEXT,
    subnets TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

  CREATE TABLE IF NOT EXISTS discovered_hosts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stack_id TEXT REFERENCES stacks(id),
    ip_address TEXT NOT NULL,
    hostname TEXT,
    mac_address TEXT,
    vendor TEXT,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovered_services (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL REFERENCES discovered_hosts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    port INTEGER NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'tcp',
    service_name TEXT,
    service_version TEXT,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_provider_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    key_fingerprint TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    diagnostics_model TEXT,
    autofix_model TEXT,
    platform_fallback INTEGER NOT NULL DEFAULT 0,
    last_validated_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_execution_audit (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    incident_id TEXT REFERENCES incidents(id),
    capability TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    credential_source TEXT NOT NULL,
    outcome TEXT NOT NULL,
    failure_reason TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS unknown_tools (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    detected_at INTEGER NOT NULL,
    reported INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS addon_interest (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    status TEXT NOT NULL DEFAULT 'invited',
    invited_at INTEGER NOT NULL,
    accepted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS community_submissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_doc_id TEXT REFERENCES docs(id),
    sanitized_title TEXT NOT NULL,
    sanitized_content TEXT NOT NULL,
    doc_type TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS alert_channels (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id TEXT,
    channel_id TEXT REFERENCES alert_channels(id),
    severity_min TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alert_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

  CREATE TABLE IF NOT EXISTS windlass_services (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    service_type TEXT,
    classification TEXT,
    compose_path TEXT,
    container_count INTEGER,
    memory_mb INTEGER,
    priority TEXT,
    description TEXT,
    schedule_cron_start TEXT,
    schedule_cron_stop TEXT,
    runtime_window_start TEXT,
    runtime_window_end TEXT,
    current_state TEXT,
    expected_state TEXT,
    last_state_change INTEGER,
    last_started INTEGER,
    last_stopped INTEGER,
    containers TEXT,
    usage_analytics TEXT,
    utilization_pct INTEGER,
    idle_hours_per_day INTEGER,
    scheduling_suggestion TEXT,
    override_until INTEGER,
    override_reason TEXT,
    decommissioned_at INTEGER,
    last_memory_shed_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS windlass_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id TEXT REFERENCES windlass_services(id),
    event_type TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS windlass_config (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    endpoint_url TEXT,
    sync_interval_seconds INTEGER NOT NULL DEFAULT 300,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_sync_at INTEGER,
    last_sync_status TEXT,
    last_weekly_digest_at INTEGER,
    n8n_workflow_windows_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feature_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    admin_notes TEXT,
    response_to_user TEXT,
    votes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- FTS5 search indexes
  CREATE VIRTUAL TABLE IF NOT EXISTS incidents_fts USING fts5(
    title, description, content=incidents, content_rowid=rowid
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS resolutions_fts USING fts5(
    content, content=resolutions, content_rowid=rowid
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    title, content, content=docs, content_rowid=rowid
  );
`);

console.log('✓ Schema applied successfully');
db.close();
