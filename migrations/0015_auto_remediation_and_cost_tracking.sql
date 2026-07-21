-- Migration: Add Auto-Remediation Playbooks and Cost Tracking
-- Adds support for safe automated incident remediation with playbooks
-- and comprehensive AI cost tracking per incident

-- === AUTO-REMEDIATION TABLES ===

-- Remediation playbooks (templates for automated fixes)
CREATE TABLE IF NOT EXISTS remediation_playbooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger TEXT NOT NULL,        -- JSON: { type, pattern }
  steps TEXT NOT NULL,          -- JSON array of PlaybookStep
  rollback TEXT NOT NULL,       -- JSON array for rollback steps
  requires_approval INTEGER NOT NULL DEFAULT 0,
  timeout INTEGER NOT NULL,     -- seconds
  risk_level TEXT NOT NULL DEFAULT 'medium', -- low | medium | high
  tags TEXT NOT NULL DEFAULT '[]',
  is_built_in INTEGER NOT NULL DEFAULT 0,
  version TEXT NOT NULL DEFAULT '1.0.0',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_rp_user_id ON remediation_playbooks(user_id);
CREATE INDEX idx_rp_is_built_in ON remediation_playbooks(is_built_in);

-- Execution records for playbook runs
CREATE TABLE IF NOT EXISTS remediation_executions (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL REFERENCES remediation_playbooks(id),
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|success|failed|rolled_back|cancelled
  dry_run INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,
  approved_at INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  logs TEXT NOT NULL DEFAULT '[]',       -- JSON array of ExecutionLog
  rollback_attempted INTEGER NOT NULL DEFAULT 0,
  rollback_success INTEGER
);

CREATE INDEX idx_re_user_id ON remediation_executions(user_id);
CREATE INDEX idx_re_incident_id ON remediation_executions(incident_id);
CREATE INDEX idx_re_playbook_id ON remediation_executions(playbook_id);
CREATE INDEX idx_re_status ON remediation_executions(status);

-- Individual step execution results
CREATE TABLE IF NOT EXISTS remediation_execution_steps (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES remediation_executions(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|success|failed|skipped|timeout
  output TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  retries_used INTEGER NOT NULL DEFAULT 0,
  executed_at INTEGER
);

CREATE INDEX idx_res_execution_id ON remediation_execution_steps(execution_id);

-- === COST TRACKING TABLES ===

-- Add cost columns to incidents table if not already present
-- This is handled via ALTER TABLE in db/index.ts for SQLite compatibility

-- Detailed cost audit trail per LLM call
CREATE TABLE IF NOT EXISTS cost_audit (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  provider TEXT NOT NULL, -- ollama|openai|anthropic|gemini
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ca_incident_id ON cost_audit(incident_id);
CREATE INDEX idx_ca_provider ON cost_audit(provider);
CREATE INDEX idx_ca_created_at ON cost_audit(created_at);

-- === INCIDENT COST COLUMNS ===
-- Note: These columns must be added to the incidents table:
-- - ai_cost_usd REAL DEFAULT 0
-- - ai_tokens_used INTEGER DEFAULT 0
-- - ai_provider TEXT
--
-- This is handled in src/lib/db/index.ts via raw SQL for SQLite compatibility
