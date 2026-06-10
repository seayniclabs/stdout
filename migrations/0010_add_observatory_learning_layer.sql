-- Migration: Add Observatory Learning Layer
-- Created: 2026-06-09
-- Purpose: Add standard patterns, baselines, and feedback tables for Observatory AI agents

-- Standard incident patterns (seeded, read-only for users)
-- These ship with every StdOut installation and provide baseline knowledge
CREATE TABLE IF NOT EXISTS observatory_standard_patterns (
  id TEXT PRIMARY KEY,
  pattern_name TEXT NOT NULL,
  category TEXT NOT NULL, -- 'resource_exhaustion', 'network', 'service_crash', 'configuration', 'security', etc
  symptoms TEXT NOT NULL, -- JSON array of observable behaviors
  common_causes TEXT NOT NULL, -- JSON array of root cause possibilities
  resolution_steps TEXT NOT NULL, -- JSON array of fix steps
  confidence_threshold REAL NOT NULL, -- 0.0-1.0, how confident detection needs to be
  source TEXT NOT NULL DEFAULT 'stdlib', -- 'stdlib' | 'community' | 'user'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for fast category lookups
CREATE INDEX IF NOT EXISTS idx_observatory_patterns_category
ON observatory_standard_patterns(category);

-- Index for source filtering
CREATE INDEX IF NOT EXISTS idx_observatory_patterns_source
ON observatory_standard_patterns(source);

-- User-learned baselines for each metric per stack
-- Calculated from historical data (7-day rolling window)
CREATE TABLE IF NOT EXISTS observatory_baselines (
  id TEXT PRIMARY KEY,
  stack_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  mean REAL NOT NULL,
  std_dev REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  window_start INTEGER NOT NULL, -- Unix timestamp
  window_end INTEGER NOT NULL, -- Unix timestamp
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(stack_id, metric_name)
);

-- Index for fast stack+metric lookups
CREATE INDEX IF NOT EXISTS idx_observatory_baselines_stack_metric
ON observatory_baselines(stack_id, metric_name);

-- User feedback on agent suggestions
-- Used to improve accuracy and learn from corrections
CREATE TABLE IF NOT EXISTS observatory_feedback (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  agent_type TEXT NOT NULL, -- 'watcher' | 'analyst'
  suggestion TEXT NOT NULL, -- What the agent recommended (JSON)
  user_action TEXT NOT NULL, -- 'helpful' | 'unhelpful' | 'modified'
  actual_resolution TEXT, -- What the user actually did (if different)
  notes TEXT, -- User's optional notes
  created_at INTEGER NOT NULL
);

-- Index for incident lookups
CREATE INDEX IF NOT EXISTS idx_observatory_feedback_incident
ON observatory_feedback(incident_id);

-- Index for aggregating feedback by agent
CREATE INDEX IF NOT EXISTS idx_observatory_feedback_agent
ON observatory_feedback(agent_type);

-- User's custom patterns (extends or overrides standard patterns)
-- Users can create their own patterns based on learned experience
CREATE TABLE IF NOT EXISTS observatory_custom_patterns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stack_id TEXT, -- NULL = applies to all stacks
  based_on_standard TEXT, -- NULL or ID of standard pattern this extends/overrides
  pattern_name TEXT NOT NULL,
  category TEXT NOT NULL,
  symptoms TEXT NOT NULL, -- JSON array
  common_causes TEXT NOT NULL, -- JSON array
  resolution_steps TEXT NOT NULL, -- JSON array
  confidence_threshold REAL NOT NULL,
  times_matched INTEGER NOT NULL DEFAULT 0,
  times_successful INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_observatory_custom_patterns_user
ON observatory_custom_patterns(user_id);

-- Index for stack-specific patterns
CREATE INDEX IF NOT EXISTS idx_observatory_custom_patterns_stack
ON observatory_custom_patterns(stack_id);

-- Agent execution history (for debugging and analytics)
CREATE TABLE IF NOT EXISTS observatory_agent_runs (
  id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL, -- 'watcher' | 'analyst'
  stack_id TEXT,
  incident_id TEXT, -- NULL for watcher scans, set for analyst investigations
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL, -- 'running' | 'completed' | 'failed'
  result TEXT, -- JSON output from agent
  error TEXT, -- Error message if failed
  execution_time_ms INTEGER,
  created_at INTEGER NOT NULL
);

-- Index for recent runs
CREATE INDEX IF NOT EXISTS idx_observatory_agent_runs_started
ON observatory_agent_runs(started_at DESC);

-- Index for agent type analysis
CREATE INDEX IF NOT EXISTS idx_observatory_agent_runs_type
ON observatory_agent_runs(agent_type);
