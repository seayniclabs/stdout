-- Add user_id to windlass_config table
ALTER TABLE windlass_config ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
