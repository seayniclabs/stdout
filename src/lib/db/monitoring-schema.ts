import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { users } from './central-schema';

export const stacks = sqliteTable('stacks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(), // Markdown — services, ports, dependencies
  previousDescription: text('previous_description'), // Saved before edit for undo
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const discoveredHosts = sqliteTable('discovered_hosts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  stackId: text('stack_id'),
  ipAddress: text('ip_address').notNull().unique(),
  hostname: text('hostname'),
  macAddress: text('mac_address'),
  vendor: text('vendor'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const discoveredServices = sqliteTable('discovered_services', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(),
  userId: text('user_id').notNull(),
  port: integer('port').notNull(),
  protocol: text('protocol').notNull().default('tcp'),
  serviceName: text('service_name'),
  serviceVersion: text('service_version'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const monitors = sqliteTable('monitors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['http', 'tcp', 'docker', 'ping', 'dns', 'output-freshness'],
  }).notNull(),
  target: text('target').notNull(),
  intervalSeconds: integer('interval_seconds').notNull().default(60),
  timeoutMs: integer('timeout_ms').notNull().default(5000),
  expectedStatus: integer('expected_status'),
  retries: integer('retries').notNull().default(3),
  stackId: text('stack_id'),
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  maintenance: integer('maintenance', { mode: 'boolean' }).notNull().default(false),
  currentStatus: text('current_status', {
    enum: ['healthy', 'degraded', 'down', 'maintenance', 'unknown'],
  }).notNull().default('unknown'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
  lastResponseMs: integer('last_response_ms'),
  jsonPath: text('json_path'),
  freshnessWindowSeconds: integer('freshness_window_seconds'),
  fingerprint: text('fingerprint'), // For deduplication
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const checkResults = sqliteTable('check_results', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id').notNull(),
  userId: text('user_id').notNull(),
  success: integer('success', { mode: 'boolean' }).notNull(),
  responseTime: integer('response_time'),
  statusCode: integer('status_code'),
  error: text('error'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
});

export const uptimeDaily = sqliteTable('uptime_daily', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id').notNull(),
  userId: text('user_id').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  successCount: integer('success_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  avgResponseTime: integer('avg_response_time'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const incidents = sqliteTable('incidents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  stackId: text('stack_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  severity: text('severity', {
    enum: ['critical', 'high', 'medium', 'low'],
  }).notNull().default('medium'),
  status: text('status', {
    enum: ['active', 'investigating', 'monitoring', 'resolved'],
  }).notNull().default('active'),
  tags: text('tags'),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  // Deduplication columns
  fingerprint: text('fingerprint'),
  duplicateOf: text('duplicate_of'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  // Cost tracking columns
  aiCostUsd: real('ai_cost_usd').notNull().default(0),
  aiTokensUsed: integer('ai_tokens_used').notNull().default(0),
  aiProvider: text('ai_provider'), // 'ollama' | 'openai' | 'anthropic' | 'gemini'
});

export const incidentOccurrences = sqliteTable('incident_occurrences', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
});

export const resolutions = sqliteTable('resolutions', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  userId: text('user_id').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const diagnoses = sqliteTable('diagnoses', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  rootCauses: text('root_causes').notNull(),
  suggestedCommands: text('suggested_commands'),
  matchedIncidentIds: text('matched_incident_ids'),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  toolUsed: text('tool_used'), // JSON: { tool, args, output, exitCode }
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const incidents_updated = sqliteTable('incidents_updated', {
  // This is a marker table to track that cost columns were added to incidents
  // The actual columns are in the incidents table migration
  id: text('id').primaryKey(),
  migrationVersion: integer('migration_version').notNull().default(1),
});

