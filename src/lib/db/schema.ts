import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
export * from './monitoring-schema';
export * from './observatory-schema';
export * from './agent-schema';
export * from './llm-schema';
import { incidents } from './monitoring-schema';

// ============================================================================
// UNIFIED SCHEMA FOR SELF-HOSTED StdOut
// ============================================================================
// This schema combines what was previously split between central-schema.ts
// and tenant-schema.ts. For self-hosted deployments, there's no need for
// multi-tenancy, workspace switching, or separate databases per user.
//
// Removed multi-tenant tables:
// - teamMembers (workspace team management)
// - tenantPreferences (workspace-specific settings)
// - deletions (GDPR compliance tracking, unused)
//
// Simplified for single-user or simple multi-user self-hosted deployment.
// ============================================================================

// --- USERS & AUTHENTICATION ---

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role', {
    enum: ['superadmin', 'admin', 'member'],
  }).notNull().default('member'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  privacyAcceptedAt: integer('privacy_accepted_at', { mode: 'timestamp_ms' }),
  dpaAcceptedAt: integer('dpa_accepted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const passwordResets = sqliteTable('password_resets', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const emailVerifications = sqliteTable('email_verifications', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const userSettings = sqliteTable('user_settings', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const commsChannels = sqliteTable('comms_channels', {
  id: text('id').primaryKey(),
  channelType: text('channel_type', {
    enum: ['slack', 'sms', 'webhook', 'email', 'websocket'],
  }).notNull(),
  name: text('name').notNull(),
  config: text('config').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const commsMessages = sqliteTable('comms_messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  direction: text('direction', {
    enum: ['inbound', 'outbound'],
  }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'),
  timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
});







// --- LICENSE & SETUP ---

export const license = sqliteTable('license', {
  key: text('key').primaryKey(),
  email: text('email').notNull(),
  edition: text('edition').notNull().default('self-host'),
  activatedAt: integer('activated_at', { mode: 'timestamp_ms' }).notNull(),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
});

export const setupProgress = sqliteTable('setup_progress', {
  id: text('id').primaryKey(),
  stepNumber: integer('step_number').notNull(),
  stepName: text('step_name').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  data: text('data'), // JSON string
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const setupConfig = sqliteTable('setup_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const systemState = sqliteTable('system_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  action: text('action').notNull(),
  details: text('details'),
  ip: text('ip'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const deletions = sqliteTable('deletions', {
  id: text('id').primaryKey(),
  emailHash: text('email_hash').notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- INFRASTRUCTURE & MONITORING ---













// --- INCIDENTS & DIAGNOSIS ---









// --- TICKETING ---

export const tickets = sqliteTable('tickets', {
  id: text('id').primaryKey(),
  type: text('type', {
    enum: ['incident', 'bug', 'feature', 'task'],
  }).notNull().default('incident'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  stackId: text('stack_id'),
  priority: text('priority', {
    enum: ['urgent', 'high', 'normal', 'low'],
  }).notNull().default('normal'),
  status: text('status', {
    enum: ['open', 'in_progress', 'resolved', 'closed'],
  }).notNull().default('open'),
  assigneeId: text('assignee_id'),
  dueDate: integer('due_date', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const ticketingConnectors = sqliteTable('ticketing_connectors', {
  id: text('id').primaryKey(),
  type: text('type', {
    enum: ['linear', 'jira', 'github'],
  }).notNull(),
  name: text('name').notNull(),
  config: text('config').notNull(), // JSON
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- DOCUMENTATION ---

export const docs = sqliteTable('docs', {
  id: text('id').primaryKey(),
  type: text('type', {
    enum: ['runbook', 'note', 'guide', 'post-mortem'],
  }).notNull(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  content: text('content').notNull(),
  tags: text('tags'),
  visibility: text('visibility', {
    enum: ['private', 'workspace', 'public'],
  }).notNull().default('private'),
  // Phase 3.1: Open-Notebook RAG fields
  chunks: text('chunks'), // JSON array of chunked content
  embeddings: text('embeddings'), // JSON array of vectors
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const docChunks = sqliteTable('doc_chunks', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: text('embedding'), // JSON vector
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const docEmbeddings = sqliteTable('doc_embeddings', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  embedding: text('embedding').notNull(), // JSON array
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- OBSERVATORY AI ---













// --- AI PROVIDERS & DATA SOURCES ---

export const aiProviderKeys = sqliteTable('ai_provider_keys', {
  id: text('id').primaryKey(),
  provider: text('provider', {
    enum: ['anthropic', 'openai', 'gemini'],
  }).notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  status: text('status', { enum: ['active', 'inactive', 'invalid'] }).notNull().default('active'),
  diagnosticsModel: text('diagnostics_model'),
  autofixModel: text('autofix_model'),
  platformFallback: integer('platform_fallback', { mode: 'boolean' }).notNull().default(true),
  lastValidatedAt: integer('last_validated_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const aiExecutionAudit = sqliteTable('ai_execution_audit', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id'),
  capability: text('capability', {
    enum: ['diagnostics', 'autofix_plan', 'autofix_apply'],
  }).notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  credentialSource: text('credential_source', {
    enum: ['user_key', 'platform_key', 'ollama'],
  }).notNull(),
  outcome: text('outcome', {
    enum: ['success', 'failed', 'blocked'],
  }).notNull(),
  failureReason: text('failure_reason'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const dataSources = sqliteTable('data_sources', {
  id: text('id').primaryKey(),
  type: text('type', {
    enum: ['prometheus', 'loki', 'influxdb', 'elasticsearch'],
  }).notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  username: text('username'),
  passwordHash: text('password_hash'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- ALERTS & NOTIFICATIONS ---

export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id'),
  name: text('name').notNull(),
  condition: text('condition').notNull(),
  threshold: text('threshold').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const alertChannels = sqliteTable('alert_channels', {
  id: text('id').primaryKey(),
  type: text('type', {
    enum: ['email', 'slack', 'webhook', 'discord'],
  }).notNull(),
  name: text('name').notNull(),
  config: text('config').notNull(), // JSON
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const alertEvents = sqliteTable('alert_events', {
  id: text('id').primaryKey(),
  alertRuleId: text('alert_rule_id').notNull(),
  monitorId: text('monitor_id'),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
});

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  eventType: text('event_type').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- SYSTEM SETTINGS (single-instance configuration) ---

export const systemSettings = sqliteTable('system_settings', {
  id: text('id').primaryKey().$defaultFn(() => 'instance'),
  // Branding
  workspaceName: text('workspace_name').$defaultFn(() => 'StdOut'),
  accentColor: text('accent_color').$defaultFn(() => '#F97316'),
  logoUrl: text('logo_url'),
  // Onboarding
  onboardingProgress: text('onboarding_progress'),
  onboardingDismissed: integer('onboarding_dismissed', { mode: 'boolean' }).$defaultFn(() => false),
  addonsDismissed: integer('addons_dismissed', { mode: 'boolean' }).$defaultFn(() => false),
  addonsHidden: integer('addons_hidden', { mode: 'boolean' }).$defaultFn(() => false),
  addonsCache: text('addons_cache'),
  addonsCacheAt: integer('addons_cache_at', { mode: 'timestamp_ms' }),
  // Observatory settings
  operatingMode: text('operating_mode', {
    enum: ['discover', 'diagnose', 'autofix'],
  }).$defaultFn(() => 'discover'),
  autopilotEnabled: integer('autopilot_enabled', { mode: 'boolean' }).$defaultFn(() => false),
  autopilotLevel: text('autopilot_level', {
    enum: ['discover', 'diagnose', 'autofix'],
  }).$defaultFn(() => 'discover'),
  autopilotSuccessCount: integer('autopilot_success_count').$defaultFn(() => 0),
  autopilotFailCount: integer('autopilot_fail_count').$defaultFn(() => 0),
  autopilotLevelSince: integer('autopilot_level_since'),
  killswitchTripped: integer('killswitch_tripped', { mode: 'boolean' }).$defaultFn(() => false),
  killswitchReason: text('killswitch_reason'),
  killswitchAt: integer('killswitch_at'),
  godModeGranted: integer('god_mode_granted', { mode: 'boolean' }).$defaultFn(() => false),
  godModeGrantedBy: text('god_mode_granted_by'),
  godModeGrantedAt: integer('god_mode_granted_at'),
  ragIncludePublic: integer('rag_include_public', { mode: 'boolean' }).$defaultFn(() => true),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
});


// --- SATELLITES & NETWORK MONITORING ---

export const satelliteAgents = sqliteTable('satellite_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hostname: text('hostname').notNull(),
  ipAddress: text('ip_address').notNull(),
  apiKey: text('api_key').notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeen: integer('last_seen'),
  lastReport: text('last_report'),
  alertState: text('alert_state').notNull().default('ok'),
  tags: text('tags').notNull().default('[]'),
});

export const satelliteReports = sqliteTable('satellite_reports', {
  id: text('id').primaryKey(),
  satelliteId: text('satellite_id').notNull(),
  metrics: text('metrics').notNull(), // JSON
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
});

export const scannerSchedule = sqliteTable('scanner_schedule', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  interval: text('interval').notNull().default('daily'),
  hour: integer('hour').notNull().default(3),
  minute: integer('minute').notNull().default(0),
  weekday: integer('weekday').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  modules: text('modules').notNull().default('["docker","metrics"]'),
  subnets: text('subnets'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- WINDLASS (Network Diagnostic Toolbox) ---

export const windlassServices = sqliteTable('windlass_services', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const windlassEvents = sqliteTable('windlass_events', {
  id: text('id').primaryKey(),
  serviceId: text('service_id'), // NULL = system-level event (Suricata, sync, etc.)
  eventType: text('event_type').notNull(),
  details: text('details').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const windlassConfig = sqliteTable('windlass_config', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  endpointUrl: text('endpoint_url').notNull(), // e.g. http://localhost:8116
  syncIntervalSeconds: integer('sync_interval_seconds').notNull().default(60),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  lastSyncStatus: text('last_sync_status'),    // 'ok' | error message
  lastWeeklyDigestAt: integer('last_weekly_digest_at', { mode: 'timestamp_ms' }),
  n8nWorkflowWindowsJson: text('n8n_workflow_windows_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const unknownTools = sqliteTable('unknown_tools', {
  id: text('id').primaryKey(),
  toolName: text('tool_name').notNull(),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
});

// --- COMMUNITY & SUBMISSIONS ---

export const communitySubmissions = sqliteTable('community_submissions', {
  id: text('id').primaryKey(),
  originalDocId: text('original_doc_id').notNull(),
  sanitizedTitle: text('sanitized_title').notNull(),
  sanitizedContent: text('sanitized_content').notNull(),
  docType: text('doc_type').notNull().default('note'),
  tags: text('tags'),
  sanitizationLog: text('sanitization_log'),
  valueScore: integer('value_score'),
  status: text('status', {
    enum: ['pending', 'published', 'rejected', 'withdrawn'],
  }).notNull().default('pending'),
  reviewNotes: text('review_notes'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
});

// --- MISC ---

export const stackImports = sqliteTable('stack_imports', {
  id: text('id').primaryKey(),
  source: text('source', {
    enum: ['docker', 'portainer', 'traefik', 'manual'],
  }).notNull(),
  stackId: text('stack_id'),
  importedData: text('imported_data').notNull(), // JSON
  status: text('status', {
    enum: ['pending', 'completed', 'failed'],
  }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const statusPage = sqliteTable('status_page', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  slug: text('slug').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const addonInterest = sqliteTable('addon_interest', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  productName: text('product_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const featureRequests = sqliteTable('feature_requests', {
  id: text('id').primaryKey(),
  email: text('email'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category'),
  votes: integer('votes').notNull().default(1),
  status: text('status', {
    enum: ['open', 'planned', 'in_progress', 'completed', 'declined'],
  }).notNull().default('open'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- ENTITY GRAPH DATABASE ---
// Network topology as queryable graph structure

export const entities = sqliteTable('entities', {
  id: text('id').primaryKey(),
  type: text('type', {
    enum: ['host', 'container', 'service', 'network', 'switch', 'router', 'device'],
  }).notNull(),
  name: text('name').notNull(),
  properties: text('properties', { mode: 'json' }), // JSON blob for flexible metadata
  discoveredAt: integer('discovered_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeen: integer('last_seen', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const entityRelationships = sqliteTable('entity_relationships', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['runs_on', 'connects_to', 'depends_on', 'part_of', 'serves'],
  }).notNull(),
  metadata: text('metadata', { mode: 'json' }), // Optional relationship metadata (port, protocol, etc.)
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- SKINS & THEMING ---

export const skins = sqliteTable('skins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  author: text('author'),
  version: text('version').notNull().default('1.0.0'),
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  colors: text('colors').notNull(), // JSON
  typography: text('typography'), // JSON
  spacing: text('spacing'), // JSON
  shadows: text('shadows'), // JSON
  effects: text('effects'), // JSON
  thumbnail: text('thumbnail'),
  tags: text('tags'),
  installCount: integer('install_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const userSkinPreferences = sqliteTable('user_skin_preferences', {
  activeSkinId: text('active_skin_id').references(() => skins.id, { onDelete: 'set null' }),
  customOverrides: text('custom_overrides'), // JSON
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- COLLECTOR FOUNDATION ---
// Registry + event stream for the 4 canonical surface collectors:
// prometheus (text scrape), syslog (UDP RFC5424), docker (socket API), rest (HTTP poll)

export const collectorConfigs = sqliteTable('collector_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  type: text('type', {
    enum: ['prometheus', 'syslog', 'docker', 'rest'],
  }).notNull(),
  config: text('config').notNull().default('{}'), // JSON — collector-specific config
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRun: integer('last_run', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const dataSourceEvents = sqliteTable('data_source_events', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(),
  type: text('type').notNull(),
  attributes: text('attributes').notNull(), // JSON
  timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
  sourceId: text('source_id'),
  sourceType: text('source_type').notNull(),
});

// --- AUTO-REMEDIATION PLAYBOOKS ---







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
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- OBSERVATORY AGENT (STEER) ---




