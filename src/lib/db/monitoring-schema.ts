import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const stacks = sqliteTable('stacks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  previousDescription: text('previous_description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms'}).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const discoveredHosts = sqliteTable('discovered_hosts', {
  id: text('id').primaryKey(),
  stackId: text('stack_id'),
  ipAddress: text('ip_address').notNull().unique(),
  hostname: text('hostname'),
  macAddress: text('mac_address'),
  vendor: text('vendor'),
  deviceType: text('device_type'), // BUGFIX (2026-08-17): Added missing columns for discovery worker
  openPorts: text('open_ports'), // JSON array
  services: text('services'), // JSON array
  osGuess: text('os_guess'),
  parentHostId: text('parent_host_id'), // For Docker containers: ID of the physical host running this container
  discoveredAt: integer('discovered_at', { mode: 'timestamp_ms' }),
  lastSeen: integer('last_seen', { mode: 'timestamp_ms' }).notNull(),
  // Home Assistant-style connection tracking (2026-08-20)
  connectionStatus: text('connection_status', {
    enum: ['discovered', 'connecting', 'connected', 'needs_config', 'ignored', 'failed'],
  }).notNull().default('discovered'),
  connectionAttemptedAt: integer('connection_attempted_at', { mode: 'timestamp_ms' }),
  connectionError: text('connection_error'),
  credentials: text('credentials'), // JSON encrypted credentials
  ignoreReason: text('ignore_reason'),
  ignoredAt: integer('ignored_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const discoveredServices = sqliteTable('discovered_services', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(),
  port: integer('port').notNull(),
  protocol: text('protocol').notNull().default('tcp'),
  serviceName: text('service_name'),
  serviceVersion: text('service_version'),
  lastSeen: integer('last_seen', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// Home Assistant-style integration configurations (2026-08-20)
export const integrationConfigs = sqliteTable('integration_configs', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(), // FK to discovered_hosts
  integrationType: text('integration_type').notNull(), // 'docker', 'prometheus', 'mysql', 'redis', etc.
  config: text('config').notNull(), // JSON config (encrypted credentials)
  status: text('status', {
    enum: ['pending', 'connected', 'failed', 'disabled'],
  }).notNull().default('pending'),
  lastConnectionAttempt: integer('last_connection_attempt', { mode: 'timestamp_ms' }),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// Home Assistant-style ignored discoveries (2026-08-20)
export const ignoredDiscoveries = sqliteTable('ignored_discoveries', {
  id: text('id').primaryKey(),
  uniqueId: text('unique_id').notNull().unique(), // IP + MAC or service fingerprint
  ipAddress: text('ip_address').notNull(),
  macAddress: text('mac_address'),
  hostname: text('hostname'),
  reason: text('reason'), // User's ignore reason
  ignoredAt: integer('ignored_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const incidents = sqliteTable('incidents', {
  id: text('id').primaryKey(),
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
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  fingerprint: text('fingerprint'),
  duplicateOf: text('duplicate_of'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  costImpact: real('cost_impact'),
  attachments: text('attachments'),
  aiCostUsd: real('ai_cost_usd').notNull().default(0),
  aiTokensUsed: integer('ai_tokens_used').notNull().default(0),
  aiProvider: text('ai_provider'),
});

export const resolutions = sqliteTable('resolutions', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
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
  toolUsed: text('tool_used'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const incidentEmbeddings = sqliteTable('incident_embeddings', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  embeddingVector: text('embedding_vector').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const monitors = sqliteTable('monitors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['http', 'ping', 'port', 'dns', 'ssl'],
  }).notNull(),
  target: text('target').notNull(),
  intervalSeconds: integer('interval_seconds').notNull().default(60),
  timeoutMs: integer('timeout_ms').notNull().default(5000),
  expectedStatus: integer('expected_status').default(200),
  retries: integer('retries').notNull().default(3),
  stackId: text('stack_id'),
  config: text('config'), // JSON config for monitor-specific settings
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  maintenance: integer('maintenance', { mode: 'boolean' }).notNull().default(false),
  currentStatus: text('current_status', {
    enum: ['up', 'down', 'degraded', 'unknown'],
  }).notNull().default('unknown'),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
  latencyMs: integer('latency_ms'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const checkResults = sqliteTable('check_results', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id').notNull(),
  status: text('status').notNull(),
  responseTimeMs: integer('response_time_ms'),
  latencyMs: integer('latency_ms'),
  statusCode: integer('status_code'),
  error: text('error'),
  checkedAt: integer('checked_at', { mode: 'timestamp_ms' }).notNull(),
});

export const uptimeDaily = sqliteTable('uptime_daily', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id').notNull(),
  date: text('date').notNull(),
  successCount: integer('success_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  avgResponseTime: integer('avg_response_time'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

export const incidentOccurrences = sqliteTable('incident_occurrences', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
});

export const incidents_updated = sqliteTable('incidents_updated', {
  id: text('id').primaryKey(),
  migrationVersion: integer('migration_version').notNull().default(1),
});
