-- Migration: Home Assistant-style Discovery Integration
-- Date: 2026-08-20
-- Purpose: Add connection tracking, integration configs, and ignore list

-- 1. Add new columns to discovered_hosts for connection tracking
ALTER TABLE discovered_hosts ADD COLUMN connectionStatus TEXT NOT NULL DEFAULT 'discovered'
  CHECK(connectionStatus IN ('discovered', 'connecting', 'connected', 'needs_config', 'ignored', 'failed'));
ALTER TABLE discovered_hosts ADD COLUMN connectionAttemptedAt INTEGER;
ALTER TABLE discovered_hosts ADD COLUMN connectionError TEXT;
ALTER TABLE discovered_hosts ADD COLUMN credentials TEXT; -- JSON encrypted
ALTER TABLE discovered_hosts ADD COLUMN ignoreReason TEXT;
ALTER TABLE discovered_hosts ADD COLUMN ignoredAt INTEGER;

-- 2. Create integration_configs table
CREATE TABLE IF NOT EXISTS integration_configs (
  id TEXT PRIMARY KEY,
  hostId TEXT NOT NULL,
  integrationType TEXT NOT NULL,
  config TEXT NOT NULL, -- JSON config with encrypted credentials
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'connected', 'failed', 'disabled')),
  lastConnectionAttempt INTEGER,
  errorMessage TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (hostId) REFERENCES discovered_hosts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integration_configs_hostId ON integration_configs(hostId);
CREATE INDEX IF NOT EXISTS idx_integration_configs_status ON integration_configs(status);

-- 3. Create ignored_discoveries table
CREATE TABLE IF NOT EXISTS ignored_discoveries (
  id TEXT PRIMARY KEY,
  uniqueId TEXT NOT NULL UNIQUE, -- IP+MAC fingerprint
  ipAddress TEXT NOT NULL,
  macAddress TEXT,
  hostname TEXT,
  reason TEXT,
  ignoredAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ignored_discoveries_uniqueId ON ignored_discoveries(uniqueId);
CREATE INDEX IF NOT EXISTS idx_ignored_discoveries_ipAddress ON ignored_discoveries(ipAddress);
