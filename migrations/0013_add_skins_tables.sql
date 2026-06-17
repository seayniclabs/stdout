-- Migration: Add skins and user_skin_preferences tables
-- Implements F006: Theming and Skins System

-- Create skins table
CREATE TABLE IF NOT EXISTS skins (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE, -- null for built-in skins
  name TEXT NOT NULL,
  description TEXT,
  author TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  is_built_in INTEGER NOT NULL DEFAULT 0, -- boolean
  is_public INTEGER NOT NULL DEFAULT 0, -- boolean
  colors TEXT NOT NULL, -- JSON
  typography TEXT, -- JSON
  spacing TEXT, -- JSON
  shadows TEXT, -- JSON
  effects TEXT, -- JSON
  thumbnail TEXT,
  tags TEXT,
  install_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Create user_skin_preferences table
CREATE TABLE IF NOT EXISTS user_skin_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_skin_id TEXT REFERENCES skins(id) ON DELETE SET NULL,
  custom_overrides TEXT, -- JSON
  updated_at INTEGER NOT NULL
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_skins_user_id ON skins(user_id);
CREATE INDEX IF NOT EXISTS idx_skins_is_built_in ON skins(is_built_in);
