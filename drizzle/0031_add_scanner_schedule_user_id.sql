-- Add user_id to scanner_schedule table
ALTER TABLE scanner_schedule ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
