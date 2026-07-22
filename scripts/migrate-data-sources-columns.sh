#!/bin/bash
# Migration: Add missing columns to data_sources table
# Schema drift fix — tenant-schema.ts has these columns but production DB doesn't

set -e

DB_PATH="${DB_PATH:-/data/stdout.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "Error: Database not found at $DB_PATH"
  exit 1
fi

echo "Adding missing columns to data_sources table..."

sqlite3 "$DB_PATH" <<'SQL'
-- Add token column (encrypted API token for data sources)
ALTER TABLE data_sources ADD COLUMN token TEXT;

-- Add org column (InfluxDB organization)
ALTER TABLE data_sources ADD COLUMN org TEXT;

-- Add bucket column (InfluxDB bucket)
ALTER TABLE data_sources ADD COLUMN bucket TEXT;

-- Add lastTestedAt column (last connection test timestamp)
ALTER TABLE data_sources ADD COLUMN last_tested_at INTEGER;

-- Add lastTestStatus column (connection test result)
ALTER TABLE data_sources ADD COLUMN last_test_status TEXT;

-- Rename password_hash to password (to match schema)
-- SQLite doesn't support ALTER COLUMN, so we'll leave password_hash as-is
-- The code will need to handle both column names

SQL

echo "Migration complete. Verifying..."
sqlite3 "$DB_PATH" ".schema data_sources"
