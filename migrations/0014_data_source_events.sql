-- Migration: Add canonical data source event tables for collector foundation
-- Created: 2026-07-06
-- Adds: collector_configs (registry), data_source_events (normalized event stream)

-- collector_configs: registry for all collector types (prometheus, syslog, docker, rest)
CREATE TABLE IF NOT EXISTS collector_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,           -- prometheus | syslog | docker | rest
  config TEXT NOT NULL DEFAULT '{}', -- JSON: collector-specific config (url, port, labels, etc.)
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run INTEGER,             -- Unix epoch seconds (UTC)
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cc_type ON collector_configs(type);
CREATE INDEX IF NOT EXISTS idx_cc_enabled ON collector_configs(enabled);

-- data_source_events: normalized UTC event stream from all collectors
-- entity: the thing being observed (hostname, container name, service name)
-- type: dot-namespaced event type (e.g. memory.available, docker.stats, syslog.kernel)
-- attributes: JSON blob with source-specific fields
-- timestamp: UTC event time (Unix epoch seconds)
-- source_id: FK to collector_configs.id (nullable for ad-hoc events)
-- source_type: prometheus | syslog | docker | rest
CREATE TABLE IF NOT EXISTS data_source_events (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  type TEXT NOT NULL,
  attributes TEXT NOT NULL,     -- JSON
  timestamp INTEGER NOT NULL,   -- Unix epoch seconds (UTC)
  source_id TEXT,
  source_type TEXT NOT NULL
);

-- Fast queries: by entity+type+time (dashboard queries), by time (cleanup), by source
CREATE INDEX IF NOT EXISTS idx_dse_entity_type_ts ON data_source_events(entity, type, timestamp);
CREATE INDEX IF NOT EXISTS idx_dse_timestamp ON data_source_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_dse_source_id ON data_source_events(source_id);
