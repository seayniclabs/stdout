-- Migration: Add data_sources table for auto-discovered monitoring tools
-- Created: 2026-06-09

-- Data sources table (central DB)
CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- prometheus, influxdb, grafana, etc.
  name TEXT NOT NULL,                    -- container name or custom name
  url TEXT NOT NULL UNIQUE,              -- connection URL
  port INTEGER NOT NULL,                 -- port number
  discovered_via TEXT NOT NULL,          -- docker_image, docker_label, manual
  enabled INTEGER NOT NULL DEFAULT 1,    -- 1 = enabled, 0 = disabled
  config TEXT,                           -- JSON config (auth, headers, etc.)
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources(type);
CREATE INDEX IF NOT EXISTS idx_data_sources_enabled ON data_sources(enabled);
