-- Add index for monitors user_id
CREATE INDEX IF NOT EXISTS idx_monitors_user_id ON monitors(user_id);
