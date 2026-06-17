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

// DB_PATH is the single source of truth — must match src/lib/db/index.ts (self-host uses /data/stdout.db)
const dbPath = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
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
    tool_used TEXT,
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
    json_path TEXT,
    freshness_window_seconds INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS check_results (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    success INTEGER NOT NULL,
    response_time INTEGER,
    status_code INTEGER,
    error TEXT,
    checked_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time ON check_results(monitor_id, checked_at);
  CREATE TABLE IF NOT EXISTS uptime_daily (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    avg_response_time INTEGER,
    updated_at INTEGER NOT NULL
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
// ── Observatory operating modes + auto-pilot (Charlie 2026-06-12) ──────────────
// operating_mode: the manual mode ladder — 'discover' (default, eyes only) |
//   'diagnose' (eyes + brain) | 'autofix' (apply, capped at non-destructive).
safeAddColumn('tenant_preferences', 'operating_mode', "TEXT NOT NULL DEFAULT 'discover'");
// autopilot_enabled: when 1, the system self-escalates discover→diagnose→autofix,
//   gated on demonstrated success. Ceiling is non-destructive auto-fix (never god mode).
safeAddColumn('tenant_preferences', 'autopilot_enabled', 'INTEGER NOT NULL DEFAULT 0');
// autopilot_level: the level auto-pilot has CURRENTLY earned ('discover'|'diagnose'|'autofix').
safeAddColumn('tenant_preferences', 'autopilot_level', "TEXT NOT NULL DEFAULT 'discover'");
// Rolling success/fail counters at the current auto-pilot level (drive promotion gate).
safeAddColumn('tenant_preferences', 'autopilot_success_count', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('tenant_preferences', 'autopilot_fail_count', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('tenant_preferences', 'autopilot_level_since', 'INTEGER'); // ms epoch level was entered
// killswitch: when tripped, auto-pilot is force-demoted to diagnose-only until cleared.
safeAddColumn('tenant_preferences', 'killswitch_tripped', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('tenant_preferences', 'killswitch_reason', 'TEXT');
safeAddColumn('tenant_preferences', 'killswitch_at', 'INTEGER'); // ms epoch
// god_mode_granted: a HUMAN explicitly lifted the non-destructive ceiling (destructive auto-fix).
//   Auto-pilot can NEVER set this; only a manage_settings user can.
safeAddColumn('tenant_preferences', 'god_mode_granted', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('tenant_preferences', 'god_mode_granted_by', 'TEXT');
safeAddColumn('tenant_preferences', 'god_mode_granted_at', 'INTEGER');
// rag_include_public: admin opt-in to include PUBLIC web/external resources in the learning
// layer + RAG context. OFF by default — internal + community library docs are always included,
// public resources only when the StdOut admin enables this. (Charlie 2026-06-12.)
safeAddColumn('tenant_preferences', 'rag_include_public', 'INTEGER NOT NULL DEFAULT 0');
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
  CREATE TABLE IF NOT EXISTS satellite_agents (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    tags         TEXT NOT NULL DEFAULT '[]',
    token_hash   TEXT NOT NULL,
    last_seen    INTEGER,
    last_report  TEXT,
    alert_state  TEXT NOT NULL DEFAULT 'ok',
    created_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS satellite_reports (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES satellite_agents(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    reported_at INTEGER NOT NULL,
    payload     TEXT NOT NULL,
    alert_fired INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sat_reports_agent ON satellite_reports(agent_id, reported_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sat_agents_user ON satellite_agents(user_id);
`);

// --- Observatory learning layer (was migration 0010; never ran on fresh self-host boot,
//     so baselines/patterns could never be stored. Created here so every fresh DB has them). ---
db.exec(`
  CREATE TABLE IF NOT EXISTS observatory_standard_patterns (
    id TEXT PRIMARY KEY,
    pattern_name TEXT NOT NULL,
    category TEXT NOT NULL,
    symptoms TEXT NOT NULL,
    common_causes TEXT NOT NULL,
    resolution_steps TEXT NOT NULL,
    prevention_steps TEXT,
    confidence_threshold REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'stdlib',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_observatory_patterns_category ON observatory_standard_patterns(category);
  CREATE INDEX IF NOT EXISTS idx_observatory_patterns_source ON observatory_standard_patterns(source);

  CREATE TABLE IF NOT EXISTS observatory_baselines (
    id TEXT PRIMARY KEY,
    stack_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    mean REAL NOT NULL,
    std_dev REAL NOT NULL,
    sample_count INTEGER NOT NULL,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(stack_id, metric_name)
  );
  CREATE INDEX IF NOT EXISTS idx_observatory_baselines_stack_metric ON observatory_baselines(stack_id, metric_name);

  CREATE TABLE IF NOT EXISTS observatory_feedback (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    suggestion TEXT NOT NULL,
    user_action TEXT NOT NULL,
    actual_resolution TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS observatory_agent_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    stack_id TEXT,
    trigger TEXT NOT NULL,
    input_context TEXT,
    output_decision TEXT,
    decision_made TEXT,
    confidence_score REAL,
    execution_time_ms INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_observatory_agent_runs_user ON observatory_agent_runs(user_id, created_at DESC);

  -- Above-ceiling remediations awaiting HUMAN approval (Charlie 2026-06-12).
  -- When an autonomous fix exceeds the non-destructive ceiling (and god mode is not granted),
  -- the proposal is parked here against its existing incident: one row = one pending fix.
  -- status: 'pending' (awaiting human) | 'approved' (applied) | 'denied' | 'expired'.
  CREATE TABLE IF NOT EXISTS observatory_pending_fixes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    command TEXT NOT NULL,
    classification TEXT,            -- JSON: {decision,reason,reversible,destructive,precedented}
    reason TEXT,                    -- why this needs approval (e.g. 'exceeds non-destructive ceiling')
    proposed_by TEXT NOT NULL,      -- 'autopilot' | 'watcher' | 'analyst' | 'sentinel'
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,                -- user id of approver/denier
    decided_at INTEGER,
    apply_result TEXT,              -- JSON of ApplyResult once approved+run
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_observatory_pending_fixes_user ON observatory_pending_fixes(user_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_observatory_pending_fixes_incident ON observatory_pending_fixes(incident_id);

  -- Learned per-installation patterns. Column shape matches retrieval.ts (confidence_score,
  -- occurrences, last_seen, prevention_steps) — the legacy migrations/0010 shape diverged and was
  -- never created on boot. This is the canonical definition. (Charlie 2026-06-12.)
  CREATE TABLE IF NOT EXISTS observatory_custom_patterns (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    stack_id TEXT,
    based_on_standard TEXT,
    pattern_name TEXT NOT NULL,
    category TEXT NOT NULL,
    symptoms TEXT NOT NULL,
    common_causes TEXT NOT NULL,
    resolution_steps TEXT NOT NULL,
    prevention_steps TEXT,
    confidence_score REAL NOT NULL DEFAULT 0.5,
    occurrences INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_observatory_custom_patterns_user ON observatory_custom_patterns(user_id);
  CREATE INDEX IF NOT EXISTS idx_observatory_custom_patterns_stack ON observatory_custom_patterns(stack_id);
`);

// Existing DBs created before prevention_steps was added need the column (CREATE IF NOT EXISTS
// won't alter an existing table). Idempotent.
try {
  const cols = db.prepare("PRAGMA table_info(observatory_standard_patterns)").all();
  if (!cols.some((c) => c.name === 'prevention_steps')) {
    db.exec('ALTER TABLE observatory_standard_patterns ADD COLUMN prevention_steps TEXT');
  }
} catch { /* table may not exist yet — the CREATE above handles fresh DBs */ }

// ── Seed the stdlib standard-pattern library on a fresh DB (Charlie 2026-06-12) ──────────────
// The 32 curated patterns ship as JSON in the image. They give the Observatory RAG layer baseline
// knowledge from day one. Seed only stdlib rows when none exist; never touch 'auto'/user patterns.
try {
  const existing = db.prepare(
    "SELECT COUNT(*) AS n FROM observatory_standard_patterns WHERE source = 'stdlib'"
  ).get();
  if (!existing || existing.n === 0) {
    // JSON lives alongside this script in the image (copied via Dockerfile), with a dev fallback.
    const here = dirname(new URL(import.meta.url).pathname);
    const candidates = [
      resolve(here, 'standard-patterns.json'),
      resolve(here, '../src/lib/observatory/standard-patterns.json'),
    ];
    let patternsPath = null;
    for (const p of candidates) { if (existsSync(p)) { patternsPath = p; break; } }
    if (patternsPath) {
      const { readFileSync } = await import('node:fs');
      const patterns = JSON.parse(readFileSync(patternsPath, 'utf-8'));
      const now = Date.now();
      const insert = db.prepare(`
        INSERT OR IGNORE INTO observatory_standard_patterns
          (id, pattern_name, category, symptoms, common_causes, resolution_steps,
           prevention_steps, confidence_threshold, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let n = 0;
      for (const p of patterns) {
        insert.run(
          p.id, p.pattern_name, p.category,
          JSON.stringify(p.symptoms), JSON.stringify(p.common_causes), JSON.stringify(p.resolution_steps),
          JSON.stringify(p.prevention_steps || []), p.confidence_threshold, p.source || 'stdlib', now, now,
        );
        n++;
      }
      console.log(`[apply-schema] Seeded ${n} stdlib standard patterns`);
    } else {
      console.warn('[apply-schema] standard-patterns.json not found — stdlib patterns not seeded');
    }
  }
} catch (e) {
  console.warn('[apply-schema] stdlib pattern seed skipped:', e?.message || e);
}

console.log('[apply-schema] Schema applied successfully');
db.close();
