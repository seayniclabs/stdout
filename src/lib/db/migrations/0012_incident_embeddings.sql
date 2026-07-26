-- Incident History Learning: Embeddings for similarity search
-- Enables Riggins to learn from past incidents

CREATE TABLE IF NOT EXISTS incident_embeddings (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'nomic-embed-text',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX idx_incident_embeddings_incident ON incident_embeddings(incident_id);
CREATE INDEX idx_incident_embeddings_created ON incident_embeddings(created_at);

-- Feedback table for self-learning loop
CREATE TABLE IF NOT EXISTS agent_response_feedback (
  id TEXT PRIMARY KEY,
  incident_id TEXT,
  response_text TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('helpful', 'not_helpful')),
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_feedback_incident ON agent_response_feedback(incident_id);
CREATE INDEX idx_feedback_type ON agent_response_feedback(feedback_type);
CREATE INDEX idx_feedback_created ON agent_response_feedback(created_at);
