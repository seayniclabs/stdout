-- Add index for incidents user_id
CREATE INDEX IF NOT EXISTS idx_incidents_user_id ON incidents(user_id);
