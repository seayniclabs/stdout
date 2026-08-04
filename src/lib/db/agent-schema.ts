import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { users } from './central-schema';

export const agentConfig = sqliteTable('agent_config', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentName: text('agent_name').notNull().default('Riggins'),
  provider: text('provider', {
    enum: ['ollama', 'anthropic-cli', 'anthropic-api', 'gemini', 'openai', 'custom'],
  }).notNull(),
  endpoint: text('endpoint'),
  model: text('model').notNull(),
  apiKey: text('api_key'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  proactiveNotifications: integer('proactive_notifications', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const agentConversations = sqliteTable('agent_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON: tool calls, model used, tokens, etc.
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

