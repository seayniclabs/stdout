-- Add index for data_sources user_id
CREATE INDEX IF NOT EXISTS idx_data_sources_user_id ON data_sources(user_id);
