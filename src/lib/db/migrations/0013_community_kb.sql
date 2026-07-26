-- Community Knowledge Base: Curated incident patterns
-- Enables Riggins to reference common problems and solutions

CREATE TABLE IF NOT EXISTS community_kb (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  problem_pattern TEXT NOT NULL,
  solution TEXT NOT NULL,
  tags TEXT, -- JSON array of tags
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  source TEXT, -- 'seeded' | 'user_contributed' | 'auto_promoted'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_community_kb_category ON community_kb(category);
CREATE INDEX idx_community_kb_source ON community_kb(source);
CREATE INDEX idx_community_kb_votes ON community_kb(upvotes DESC, downvotes ASC);

-- User votes on community patterns
CREATE TABLE IF NOT EXISTS community_kb_votes (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (kb_id) REFERENCES community_kb(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(kb_id, user_id)
);

CREATE INDEX idx_kb_votes_kb ON community_kb_votes(kb_id);
CREATE INDEX idx_kb_votes_user ON community_kb_votes(user_id);
