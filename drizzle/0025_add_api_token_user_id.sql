-- Add user_id columns to tables for multi-user support
-- Migration: 0026_add_user_id_columns
-- Date: 2026-08-15

-- Add user_id to api_tokens (nullable first, then update, then make NOT NULL)
ALTER TABLE api_tokens ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- Add user_id to scanner_schedule (nullable first)
ALTER TABLE scanner_schedule ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- Add user_id to windlass_config (nullable first)
ALTER TABLE windlass_config ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
