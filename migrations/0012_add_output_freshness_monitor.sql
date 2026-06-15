-- Migration: Add output-freshness monitor type
-- Adds support for monitoring JSON endpoints for recent activity

-- Add new columns to monitors table
ALTER TABLE monitors ADD COLUMN json_path TEXT;
ALTER TABLE monitors ADD COLUMN freshness_window_seconds INTEGER;

-- Note: SQLite doesn't support modifying enum constraints in ALTER TABLE.
-- The new 'output-freshness' type value will be validated at the application layer
-- via the Drizzle schema enum: ['http', 'tcp', 'docker', 'ping', 'dns', 'output-freshness']
