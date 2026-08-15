-- Add config column to monitors table for storing monitor-specific configuration
ALTER TABLE monitors ADD COLUMN config TEXT;

-- Add user_id column to stacks table for multi-user support
ALTER TABLE stacks ADD COLUMN user_id TEXT;

-- Add incident_embeddings table for RAG similarity search
CREATE TABLE IF NOT EXISTS incident_embeddings (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL,
  embedding_vector TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_embeddings_incident_id ON incident_embeddings(incident_id);
