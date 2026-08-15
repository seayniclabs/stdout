-- Add user_id to api_tokens table
ALTER TABLE api_tokens ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
