#!/usr/bin/env node
/**
 * migrate-add-agent-tables.js
 *
 * Adds Observatory Agent tables to central database:
 * - agent_config (AI provider configuration)
 * - agent_conversations (chat history)
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Central DB path (user/auth/license data)
const centralDbPath = process.env.CENTRAL_DB_PATH || '/data/central.db';
console.log(`[migrate-agent] Using central database at: ${centralDbPath}`);

const dir = dirname(centralDbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const central = new Database(centralDbPath);
central.pragma('journal_mode = WAL');
central.pragma('foreign_keys = ON');

console.log('[migrate-agent] Creating agent tables...');

try {
  // Check if tables already exist
  const tableCheck = central.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('agent_config', 'agent_conversations')
  `).all();

  if (tableCheck.length === 2) {
    console.log('✓ Agent tables already exist, skipping migration');
    central.close();
    process.exit(0);
  }

  // Create agent_config table
  central.exec(`
    CREATE TABLE IF NOT EXISTS agent_config (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL DEFAULT 'Riggins',
      provider TEXT NOT NULL CHECK(provider IN ('ollama', 'anthropic-cli', 'anthropic-api', 'gemini', 'openai', 'custom')),
      endpoint TEXT,
      model TEXT NOT NULL,
      api_key TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      proactive_notifications INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_config_user_id ON agent_config(user_id);
  `);

  console.log('✓ Created agent_config table');

  // Create agent_conversations table
  central.exec(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_id ON agent_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_conversations_created_at ON agent_conversations(created_at);
  `);

  console.log('✓ Created agent_conversations table');

  console.log('[migrate-agent] ✅ Migration complete');

} catch (error) {
  console.error('[migrate-agent] ❌ Migration failed:', error.message);
  process.exit(1);
} finally {
  central.close();
}
