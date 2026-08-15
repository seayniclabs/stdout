-- Add index for stacks user_id
CREATE INDEX IF NOT EXISTS idx_stacks_user_id ON stacks(user_id);
