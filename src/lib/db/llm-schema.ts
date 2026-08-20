import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ============================================================================
// LLM PROVIDER & MODEL MANAGEMENT
// ============================================================================
// Schema for managing multiple LLM providers (NVIDIA NIM, Ollama, OpenAI, etc.)
// and routing tasks to appropriate models based on specialty.
//
// Architecture:
// - llmProviders: Provider configurations (API endpoints, credentials)
// - llmModels: Individual models within each provider
// - llmTaskRouting: Task type → preferred model mappings
// ============================================================================

export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  providerType: text('provider_type', {
    enum: ['nvidia', 'ollama', 'openai', 'anthropic', 'custom'],
  }).notNull(),
  baseUrl: text('base_url'), // null for local Ollama
  apiKeyEncrypted: text('api_key_encrypted'), // base64 for now, proper encryption later
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(100), // Lower = higher priority (0-1000)
  config: text('config'), // JSON: rate limits, timeouts, etc.
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const llmModels = sqliteTable('llm_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => llmProviders.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(), // e.g., "qwen/qwen3-coder-480b-a35b-instruct"
  displayName: text('display_name').notNull(), // e.g., "Qwen3 Coder 480B"
  specialty: text('specialty', {
    enum: ['code', 'general', 'embedding', 'vision'],
  }),
  contextWindow: integer('context_window'), // e.g., 32000
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(100), // Model priority within provider
  config: text('config'), // JSON: temperature defaults, use_for tasks, etc.
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const llmTaskRouting = sqliteTable('llm_task_routing', {
  id: text('id').primaryKey(),
  taskType: text('task_type').notNull().unique(), // "log_analysis", "network_discovery", etc.
  preferredModelId: text('preferred_model_id').references(() => llmModels.id),
  fallbackModelIds: text('fallback_model_ids'), // JSON array of model IDs
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
