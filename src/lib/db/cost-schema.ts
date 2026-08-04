import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { incidents } from './monitoring-schema';

// --- COST TRACKING ---

export const costAudit = sqliteTable('cost_audit', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull().references(() => incidents.id),
  provider: text('provider', {
    enum: ['ollama', 'openai', 'anthropic', 'gemini'],
  }).notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
