-- Migration: Fix scanner_schedule table schema
-- Drop old hybrid schema and recreate with clean new schema

-- Drop the hybrid table
DROP TABLE IF EXISTS scanner_schedule_old;
ALTER TABLE scanner_schedule RENAME TO scanner_schedule_old;

-- Create new table with correct schema (matches tenant-schema.ts)
CREATE TABLE scanner_schedule (
  id TEXT PRIMARY KEY NOT NULL,
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

-- Migrate any existing data (if the old table had rows)
INSERT INTO scanner_schedule (id, user_id, interval, hour, minute, weekday, enabled, modules, subnets, updated_at)
SELECT
  id,
  user_id,
  COALESCE(interval, 'daily'),
  COALESCE(hour, 3),
  COALESCE(minute, 0),
  COALESCE(weekday, 0),
  COALESCE(enabled, 1),
  COALESCE(modules, '["docker","metrics"]'),
  subnets,
  COALESCE(updated_at, strftime('%s', 'now') * 1000)
FROM scanner_schedule_old;

-- Drop old table
DROP TABLE scanner_schedule_old;
