-- Add user_id columns to tables that need them
-- Migration 002: User ID columns for multi-tenancy support

ALTER TABLE stacks ADD COLUMN user_id TEXT;
ALTER TABLE monitors ADD COLUMN user_id TEXT;
ALTER TABLE data_sources ADD COLUMN user_id TEXT;
ALTER TABLE incidents ADD COLUMN user_id TEXT;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_stacks_user_id ON stacks(user_id);
CREATE INDEX IF NOT EXISTS idx_monitors_user_id ON monitors(user_id);
CREATE INDEX IF NOT EXISTS idx_data_sources_user_id ON data_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_incidents_user_id ON incidents(user_id);

-- system_metrics is per-host, not per-user, so skip it
