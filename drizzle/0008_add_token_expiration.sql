-- Add token expiration column to api_tokens table
-- Tokens without expiration are treated as expired for forward compatibility
ALTER TABLE api_tokens ADD COLUMN expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 30 * 24 * 60 * 60);
