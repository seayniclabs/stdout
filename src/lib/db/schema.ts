import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

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
    enum: ['admin', 'member'],
  }).notNull().default('member'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- LICENSE & SETUP ---

export const license = sqliteTable('license', {
  key: text('key').primaryKey(),
  email: text('email').notNull(),
  edition: text('edition').notNull().default('self-host'),
  activatedAt: integer('activated_at', { mode: 'timestamp' }).notNull(),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
});

export const setupProgress = sqliteTable('setup_progress', {
  id: text('id').primaryKey(),
  stepNumber: integer('step_number').notNull(),
  stepName: text('step_name').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  data: text('data'), // JSON string
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const setupConfig = sqliteTable('setup_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const systemState = sqliteTable('system_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  details: text('details'),
  ip: text('ip'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const deletions = sqliteTable('deletions', {
  id: text('id').primaryKey(),
  emailHash: text('email_hash').notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }).notNull(),
});

// --- INFRASTRUCTURE & MONITORING ---

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

// --- INCIDENTS & DIAGNOSIS ---

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

// --- TICKETING ---

export const tickets = sqliteTable('tickets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
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
  dueDate: integer('due_date', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const ticketingConnectors = sqliteTable('ticketing_connectors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type', {
    enum: ['linear', 'jira', 'github'],
  }).notNull(),
  name: text('name').notNull(),
  config: text('config').notNull(), // JSON
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- DOCUMENTATION ---

export const docs = sqliteTable('docs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type', {
    enum: ['runbook', 'note', 'guide'],
  }).notNull(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  content: text('content').notNull(),
  tags: text('tags'),
  visibility: text('visibility', {
    enum: ['private', 'workspace', 'public'],
  }).notNull().default('private'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const docEmbeddings = sqliteTable('doc_embeddings', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  userId: text('user_id').notNull(),
  embedding: text('embedding').notNull(), // JSON array
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- OBSERVATORY AI ---

export const observatoryStandardPatterns = sqliteTable('observatory_standard_patterns', {
  id: text('id').primaryKey(),
  patternName: text('pattern_name').notNull(),
  category: text('category').notNull(),
  symptoms: text('symptoms').notNull(),
  commonCauses: text('common_causes').notNull(),
  resolutionSteps: text('resolution_steps').notNull(),
  preventionSteps: text('prevention_steps'),
  confidenceThreshold: real('confidence_threshold').notNull(),
  source: text('source').notNull().default('stdlib'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryCustomPatterns = sqliteTable('observatory_custom_patterns', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  pattern: text('pattern').notNull(),
  description: text('description').notNull(),
  suggestedCommands: text('suggested_commands'),
  preventionSteps: text('prevention_steps'),
  severity: text('severity', {
    enum: ['critical', 'high', 'medium', 'low'],
  }).notNull().default('medium'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryBaselines = sqliteTable('observatory_baselines', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  monitorId: text('monitor_id').notNull(),
  metric: text('metric').notNull(),
  baselineValue: text('baseline_value').notNull(),
  unit: text('unit'),
  confidenceScore: integer('confidence_score').notNull().default(50),
  lastCalculatedAt: integer('last_calculated_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryAgentRuns = sqliteTable('observatory_agent_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  agentType: text('agent_type', {
    enum: ['watcher', 'analyst', 'executor'],
  }).notNull(),
  incidentId: text('incident_id'),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  outcome: text('outcome').notNull(),
  executionTimeMs: integer('execution_time_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryFeedback = sqliteTable('observatory_feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  incidentId: text('incident_id').notNull(),
  diagnosisId: text('diagnosis_id'),
  feedbackType: text('feedback_type', {
    enum: ['helpful', 'not_helpful', 'incorrect', 'missing_context'],
  }).notNull(),
  comment: text('comment'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryPendingFixes = sqliteTable('observatory_pending_fixes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  incidentId: text('incident_id').notNull(),
  fixType: text('fix_type').notNull(),
  fixCommand: text('fix_command').notNull(),
  riskLevel: text('risk_level', {
    enum: ['low', 'medium', 'high'],
  }).notNull().default('medium'),
  status: text('status', {
    enum: ['pending', 'approved', 'rejected', 'applied'],
  }).notNull().default('pending'),
  approvedBy: text('approved_by'),
  appliedAt: integer('applied_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- AI PROVIDERS & DATA SOURCES ---

export const aiProviderKeys = sqliteTable('ai_provider_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  provider: text('provider', {
    enum: ['anthropic', 'openai', 'gemini'],
  }).notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  status: text('status', { enum: ['active', 'inactive', 'invalid'] }).notNull().default('active'),
  diagnosticsModel: text('diagnostics_model'),
  autofixModel: text('autofix_model'),
  platformFallback: integer('platform_fallback', { mode: 'boolean' }).notNull().default(true),
  lastValidatedAt: integer('last_validated_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const aiExecutionAudit = sqliteTable('ai_execution_audit', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const dataSources = sqliteTable('data_sources', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type', {
    enum: ['prometheus', 'loki', 'influxdb', 'elasticsearch'],
  }).notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  username: text('username'),
  passwordHash: text('password_hash'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- ALERTS & NOTIFICATIONS ---

export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  monitorId: text('monitor_id'),
  name: text('name').notNull(),
  condition: text('condition').notNull(),
  threshold: text('threshold').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const alertChannels = sqliteTable('alert_channels', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type', {
    enum: ['email', 'slack', 'webhook', 'discord'],
  }).notNull(),
  name: text('name').notNull(),
  config: text('config').notNull(), // JSON
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const alertEvents = sqliteTable('alert_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  alertRuleId: text('alert_rule_id').notNull(),
  monitorId: text('monitor_id'),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  sentAt: integer('sent_at', { mode: 'timestamp' }).notNull(),
});

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  channelId: text('channel_id').notNull(),
  eventType: text('event_type').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- TENANT PREFERENCES (temporary - remove in Task 8) ---
// NOTE: This table is kept temporarily to avoid breaking the build.
// It will be removed in Task 8 when workspace UI is cleaned up.

export const tenantPreferences = sqliteTable('tenant_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceName: text('workspace_name'),
  accentColor: text('accent_color'),
  logoUrl: text('logo_url'),
  onboardingProgress: text('onboarding_progress'),
  onboardingDismissed: integer('onboarding_dismissed', { mode: 'boolean' }).notNull().default(false),
  addonsDismissed: integer('addons_dismissed', { mode: 'boolean' }).notNull().default(false),
  addonsHidden: integer('addons_hidden', { mode: 'boolean' }).notNull().default(false),
  addonsCache: text('addons_cache'),
  addonsCacheAt: integer('addons_cache_at', { mode: 'timestamp' }),
  operatingMode: text('operating_mode', {
    enum: ['discover', 'diagnose', 'autofix'],
  }).notNull().default('discover'),
  autopilotEnabled: integer('autopilot_enabled', { mode: 'boolean' }).notNull().default(false),
  autopilotLevel: text('autopilot_level', {
    enum: ['discover', 'diagnose', 'autofix'],
  }).notNull().default('discover'),
  autopilotSuccessCount: integer('autopilot_success_count').notNull().default(0),
  autopilotFailCount: integer('autopilot_fail_count').notNull().default(0),
  autopilotLevelSince: integer('autopilot_level_since'),
  killswitchTripped: integer('killswitch_tripped', { mode: 'boolean' }).notNull().default(false),
  killswitchReason: text('killswitch_reason'),
  killswitchAt: integer('killswitch_at'),
  godModeGranted: integer('god_mode_granted', { mode: 'boolean' }).notNull().default(false),
  godModeGrantedBy: text('god_mode_granted_by'),
  godModeGrantedAt: integer('god_mode_granted_at'),
  ragIncludePublic: integer('rag_include_public', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- SATELLITES & NETWORK MONITORING ---

export const satelliteAgents = sqliteTable('satellite_agents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  hostname: text('hostname').notNull(),
  ipAddress: text('ip_address').notNull(),
  apiKey: text('api_key').notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const satelliteReports = sqliteTable('satellite_reports', {
  id: text('id').primaryKey(),
  satelliteId: text('satellite_id').notNull(),
  userId: text('user_id').notNull(),
  metrics: text('metrics').notNull(), // JSON
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
});

export const scannerSchedule = sqliteTable('scanner_schedule', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  scanType: text('scan_type', {
    enum: ['network', 'port', 'vulnerability'],
  }).notNull(),
  target: text('target').notNull(),
  schedule: text('schedule').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  nextRunAt: integer('next_run_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- WINDLASS (Network Diagnostic Toolbox) ---

export const windlassServices = sqliteTable('windlass_services', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const windlassEvents = sqliteTable('windlass_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  serviceId: text('service_id').notNull(),
  eventType: text('event_type').notNull(),
  details: text('details').notNull(), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const windlassConfig = sqliteTable('windlass_config', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  endpointUrl: text('endpoint_url').notNull(), // e.g. http://localhost:8116
  syncIntervalSeconds: integer('sync_interval_seconds').notNull().default(60),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  lastSyncStatus: text('last_sync_status'),    // 'ok' | error message
  lastWeeklyDigestAt: integer('last_weekly_digest_at', { mode: 'timestamp' }),
  n8nWorkflowWindowsJson: text('n8n_workflow_windows_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const unknownTools = sqliteTable('unknown_tools', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  toolName: text('tool_name').notNull(),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
});

// --- COMMUNITY & SUBMISSIONS ---

export const communitySubmissions = sqliteTable('community_submissions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
});

// --- MISC ---

export const stackImports = sqliteTable('stack_imports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  source: text('source', {
    enum: ['docker', 'portainer', 'traefik', 'manual'],
  }).notNull(),
  stackId: text('stack_id'),
  importedData: text('imported_data').notNull(), // JSON
  status: text('status', {
    enum: ['pending', 'completed', 'failed'],
  }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const statusPage = sqliteTable('status_page', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  slug: text('slug').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const addonInterest = sqliteTable('addon_interest', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  productName: text('product_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const featureRequests = sqliteTable('feature_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  email: text('email'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category'),
  votes: integer('votes').notNull().default(1),
  status: text('status', {
    enum: ['open', 'planned', 'in_progress', 'completed', 'declined'],
  }).notNull().default('open'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- ENTITY GRAPH DATABASE ---
// Network topology as queryable graph structure

export const entities = sqliteTable('entities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['host', 'container', 'service', 'network', 'switch', 'router', 'device'],
  }).notNull(),
  name: text('name').notNull(),
  properties: text('properties', { mode: 'json' }), // JSON blob for flexible metadata
  discoveredAt: integer('discovered_at', { mode: 'timestamp' }).notNull(),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const entityRelationships = sqliteTable('entity_relationships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['runs_on', 'connects_to', 'depends_on', 'part_of', 'serves'],
  }).notNull(),
  metadata: text('metadata', { mode: 'json' }), // Optional relationship metadata (port, protocol, etc.)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
