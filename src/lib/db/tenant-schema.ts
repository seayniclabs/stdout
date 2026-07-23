import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// --- Tenant DB: stacks, incidents, resolutions, diagnoses ---
// Lives in data/tenants/{userId}.db (SaaS) or data/stdout.db (self-host)
// Each tenant gets their own physical DB file for isolation.
// user_id columns are kept for defense-in-depth and self-host compatibility.

export const stacks = sqliteTable('stacks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(), // Markdown — services, ports, dependencies, quirks
  previousDescription: text('previous_description'), // Saved before edit for undo
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- Network Discovery: discovered hosts and services ---

export const discoveredHosts = sqliteTable('discovered_hosts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  stackId: text('stack_id'), // FK to stacks — hosts can be grouped into logical stacks
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
  hostId: text('host_id').notNull(), // FK to discoveredHosts
  userId: text('user_id').notNull(),
  port: integer('port').notNull(),
  protocol: text('protocol').notNull().default('tcp'), // tcp | udp
  serviceName: text('service_name'), // ssh, http, https, mysql, etc.
  serviceVersion: text('service_version'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const incidents = sqliteTable('incidents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  stackId: text('stack_id'),
  title: text('title').notNull(),
  description: text('description').notNull(), // Error output, symptoms, context
  severity: text('severity', {
    enum: ['critical', 'high', 'medium', 'low'],
  }).notNull().default('medium'),
  status: text('status', {
    enum: ['active', 'investigating', 'monitoring', 'resolved'],
  }).notNull().default('active'),
  tags: text('tags'), // Comma-separated: "docker,n8n,nginx"
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const resolutions = sqliteTable('resolutions', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  userId: text('user_id').notNull(),
  content: text('content').notNull(), // Markdown — what fixed it
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const diagnoses = sqliteTable('diagnoses', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  rootCauses: text('root_causes').notNull(), // JSON array of ranked causes
  suggestedCommands: text('suggested_commands'), // JSON array of commands
  matchedIncidentIds: text('matched_incident_ids'), // JSON array of past incident IDs
  model: text('model').notNull(), // "claude-haiku-4-5-20251001" etc.
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  toolUsed: text('tool_used'), // JSON object: { tool: string, args: object, output?: string, exitCode?: number }
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- Ticketing System Integration ---

export const tickets = sqliteTable('tickets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),

  // Ticket metadata
  type: text('type', {
    enum: ['incident', 'bug', 'feature', 'task'],
  }).notNull().default('incident'),

  title: text('title').notNull(),
  description: text('description').notNull(),

  // Categorization
  stackId: text('stack_id'),
  severity: text('severity', {
    enum: ['critical', 'high', 'medium', 'low'],
  }).notNull().default('medium'),
  status: text('status', {
    enum: ['open', 'in_progress', 'blocked', 'resolved', 'closed'],
  }).notNull().default('open'),
  tags: text('tags'), // Comma-separated

  // External system sync
  externalSystem: text('external_system'), // 'linear', 'jira', 'servicenow', 'github', null (built-in)
  externalId: text('external_id'), // External ticket ID
  externalUrl: text('external_url'), // Link to external ticket
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  syncDirection: text('sync_direction', {
    enum: ['inbound', 'outbound', 'bidirectional'],
  }), // How sync works
  syncStatus: text('sync_status'), // 'ok' | error message

  // Timestamps
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const ticketingConnectors = sqliteTable('ticketing_connectors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),

  system: text('system', {
    enum: ['linear', 'jira', 'servicenow', 'github', 'built-in'],
  }).notNull(),

  name: text('name').notNull(), // User-friendly label
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),

  // Connection config (encrypted JSON)
  config: text('config').notNull(), // { apiKey, workspace, project, etc. }

  // Sync settings
  syncEnabled: integer('sync_enabled', { mode: 'boolean' }).notNull().default(true),
  syncInterval: integer('sync_interval').notNull().default(300), // seconds
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastSyncStatus: text('last_sync_status'), // 'ok' | error message

  // Mapping rules (JSON)
  fieldMappings: text('field_mappings'), // How to map external fields to StdOut fields

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const docEmbeddings = sqliteTable('doc_embeddings', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull().references(() => docs.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),

  // Embedding vector (JSON array of floats)
  embedding: text('embedding').notNull(), // Serialized float[]

  // Chunking info (for long docs)
  chunkIndex: integer('chunk_index').notNull().default(0),
  chunkText: text('chunk_text').notNull(),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- Tenant Preferences: branding, display settings ---

export const tenantPreferences = sqliteTable('tenant_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceName: text('workspace_name'), // Replaces "StdOut" in nav
  accentColor: text('accent_color'), // Hex color override (e.g. #3B82F6)
  logoUrl: text('logo_url'), // Small image URL or data URI
  onboardingProgress: text('onboarding_progress'), // JSON: completed step IDs e.g. ["env","token","scanner","incident","diagnose","resolution"]
  onboardingDismissed: integer('onboarding_dismissed', { mode: 'boolean' }).notNull().default(false),
  addonsDismissed: integer('addons_dismissed', { mode: 'boolean' }).notNull().default(false),
  addonsHidden: integer('addons_hidden', { mode: 'boolean' }).notNull().default(false),
  addonsCache: text('addons_cache'),
  addonsCacheAt: integer('addons_cache_at', { mode: 'timestamp' }),
  // Observatory operating modes + auto-pilot (2026-06-12) — see lib/observatory/operating-mode.ts
  operatingMode: text('operating_mode', {
    enum: ['discover', 'diagnose', 'autofix'],
  }).notNull().default('discover'),
  autopilotEnabled: integer('autopilot_enabled', { mode: 'boolean' }).notNull().default(false),
  autopilotLevel: text('autopilot_level', {
    enum: ['discover', 'diagnose', 'autofix'],
  }).notNull().default('discover'),
  autopilotSuccessCount: integer('autopilot_success_count').notNull().default(0),
  autopilotFailCount: integer('autopilot_fail_count').notNull().default(0),
  autopilotLevelSince: integer('autopilot_level_since'), // ms epoch
  killswitchTripped: integer('killswitch_tripped', { mode: 'boolean' }).notNull().default(false),
  killswitchReason: text('killswitch_reason'),
  killswitchAt: integer('killswitch_at'), // ms epoch
  godModeGranted: integer('god_mode_granted', { mode: 'boolean' }).notNull().default(false),
  godModeGrantedBy: text('god_mode_granted_by'),
  godModeGrantedAt: integer('god_mode_granted_at'), // ms epoch
  // RAG: admin opt-in to include public web/external resources in the learning layer (off default).
  ragIncludePublic: integer('rag_include_public', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Above-ceiling remediations awaiting human approval (2026-06-12).
export const observatoryPendingFixes = sqliteTable('observatory_pending_fixes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  incidentId: text('incident_id').notNull(),
  command: text('command').notNull(),
  classification: text('classification'), // JSON ApplyClassification
  reason: text('reason'),
  proposedBy: text('proposed_by').notNull(), // 'autopilot' | 'watcher' | 'analyst' | 'sentinel'
  status: text('status', {
    enum: ['pending', 'approved', 'denied', 'expired'],
  }).notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: integer('decided_at'),
  applyResult: text('apply_result'), // JSON ApplyResult
  createdAt: integer('created_at').notNull(),
});

// --- Notification Preferences ---

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  channel: text('channel', {
    enum: ['email', 'webhook'],
  }).notNull(),
  destination: text('destination').notNull(), // Email address or webhook URL
  events: text('events').notNull(), // JSON array: ["incident_created","diagnosis_complete","severity_critical"]
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- Knowledge Base: runbooks, post-mortems, operational docs ---

export const docs = sqliteTable('docs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(), // Markdown
  docType: text('doc_type', {
    enum: ['runbook', 'postmortem', 'guide', 'note'],
  }).notNull().default('note'),
  incidentId: text('incident_id'), // Optional link to originating incident
  stackId: text('stack_id'), // Optional link to related stack
  tags: text('tags'), // Comma-separated
  sizeBytes: integer('size_bytes').notNull().default(0),
  source: text('source').notNull().default('user'), // 'user' | 'community' | 'fork'
  communityDocId: text('community_doc_id'), // Links forked docs back to community source
  communityVersion: integer('community_version'), // Tracks sync version for update detection
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- Status Page ---

export const statusPage = sqliteTable('status_page', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  slug: text('slug').notNull(),             // URL-safe identifier: /status/[slug]
  title: text('title').notNull().default('Service Status'),
  description: text('description'),          // Optional subtitle
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  monitorIds: text('monitor_ids').notNull(), // JSON array of monitor IDs to display
  showResponseTime: integer('show_response_time', { mode: 'boolean' }).notNull().default(true),
  showUptime: integer('show_uptime', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- HUD: Monitors & Check Results ---

export const monitors = sqliteTable('monitors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['http', 'tcp', 'docker', 'ping', 'dns', 'output-freshness'],
  }).notNull(),
  target: text('target').notNull(),        // URL, host:port, container name, JSON endpoint
  intervalSeconds: integer('interval_seconds').notNull().default(60),
  timeoutMs: integer('timeout_ms').notNull().default(5000),
  expectedStatus: integer('expected_status'), // HTTP: 200
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
  // Output-freshness monitor fields
  jsonPath: text('json_path'),             // JSONPath to extract timestamp (e.g., "$[0].completed_at")
  freshnessWindowSeconds: integer('freshness_window_seconds'), // Max age before alert (e.g., 21600 = 6h)
  fingerprint: text('fingerprint'), // For deduplication
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const checkResults = sqliteTable('check_results', {
  id: text('id').primaryKey(),
  monitorId: text('monitor_id').notNull(),
  status: text('status', {
    enum: ['healthy', 'degraded', 'down'],
  }).notNull(),
  responseTimeMs: integer('response_time_ms'),
  statusCode: integer('status_code'),
  error: text('error'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
});

export const uptimeDaily = sqliteTable('uptime_daily', {
  monitorId: text('monitor_id').notNull(),
  date: text('date').notNull(),            // YYYY-MM-DD
  totalChecks: integer('total_checks').notNull().default(0),
  successfulChecks: integer('successful_checks').notNull().default(0),
  avgResponseMs: integer('avg_response_ms'),
  p95ResponseMs: integer('p95_response_ms'),
});

// --- Scanner Schedule ---

export const scannerSchedule = sqliteTable('scanner_schedule', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  interval: text('interval').notNull().default('daily'), // hourly, daily, weekly, or cron expression
  hour: integer('hour').notNull().default(3),             // 0-23
  minute: integer('minute').notNull().default(0),         // 0-59
  weekday: integer('weekday').notNull().default(0),       // 0=Sun, 1=Mon, ... 6=Sat
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  modules: text('modules').notNull().default('["docker","metrics"]'), // JSON array of enabled modules
  subnets: text('subnets'),                               // JSON array, null = auto-detect
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- Data Sources: InfluxDB, Prometheus, etc. ---

export const dataSources = sqliteTable('data_sources', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),              // "My InfluxDB", "Prometheus"
  type: text('type', {
    enum: ['influxdb', 'prometheus', 'trivy', 'uptime-kuma', 'loki', 'graylog', 'crowdsec', 'pihole'],
  }).notNull(),
  url: text('url').notNull(),                // e.g. http://localhost:8086
  token: text('token'),                      // Encrypted API token (AES-256-GCM)
  username: text('username'),                // Basic auth username (Graylog)
  password: text('password'),               // Encrypted basic auth password (Graylog)
  org: text('org'),                          // InfluxDB org
  bucket: text('bucket'),                    // InfluxDB bucket
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),
  lastTestStatus: text('last_test_status'),  // 'ok' | 'error' | error message
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const unknownTools = sqliteTable('unknown_tools', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  toolName: text('tool_name').notNull(),
  detectedAt: integer('detected_at', { mode: 'timestamp' }).notNull(),
  reported: integer('reported').notNull().default(0),
});

export const addonInterest = sqliteTable('addon_interest', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  toolId: text('tool_id').notNull(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  notified: integer('notified').notNull().default(0),
});

// --- Windlass: Schedule-Aware Service Management ---

export const windlassServices = sqliteTable('windlass_services', {
  id: text('id').primaryKey(),                // e.g. "postiz", "grafana"
  userId: text('user_id').notNull(),
  name: text('name').notNull(),               // Display name
  serviceType: text('service_type', {
    enum: ['always', 'schedule', 'on-demand', 'manual'],
  }).notNull().default('manual'),
  classification: text('classification', {
    enum: ['always_on', 'scheduled', 'on_demand', 'manual'],
  }).notNull(),
  composePath: text('compose_path'),          // Path to docker-compose dir
  containerCount: integer('container_count'),
  memoryMb: integer('memory_mb'),
  priority: integer('priority').notNull().default(3), // 1=critical, 5=optional
  description: text('description'),
  scheduleCronStart: text('schedule_cron_start'), // Cron expression for start
  scheduleCronStop: text('schedule_cron_stop'),   // Cron expression for stop
  runtimeWindowStart: text('runtime_window_start'), // HH:MM for display
  runtimeWindowEnd: text('runtime_window_end'),     // HH:MM for display
  currentState: text('current_state', {
    enum: ['running', 'stopped', 'partial', 'starting', 'stopping', 'error', 'unknown'],
  }).notNull().default('unknown'),
  expectedState: text('expected_state', {
    enum: ['running', 'stopped'],
  }).notNull().default('running'),
  overrideUntil: integer('override_until', { mode: 'timestamp' }),  // Manual override — suppress mismatch until this time
  overrideReason: text('override_reason'),                          // Why the override was set
  lastStateChange: integer('last_state_change', { mode: 'timestamp' }),
  lastStarted: integer('last_started', { mode: 'timestamp' }),
  lastStopped: integer('last_stopped', { mode: 'timestamp' }),
  containers: text('containers'),             // JSON array of container names
  decommissionedAt: integer('decommissioned_at', { mode: 'timestamp' }), // Set when service hasn't appeared in sync for 24+ hours
  usageAnalytics: text('usage_analytics'),       // JSON hourly utilization + idle stats from Windlass
  utilizationPct: integer('utilization_pct'),    // Rolling utilization percent (0-100)
  idleHoursPerDay: integer('idle_hours_per_day'),// Rounded daily idle hours estimate
  schedulingSuggestion: text('scheduling_suggestion'),
  lastMemoryShedReason: text('last_memory_shed_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const windlassEvents = sqliteTable('windlass_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  serviceId: text('service_id'),              // NULL = system-level event
  eventType: text('event_type', {
    enum: ['service_started', 'service_stopped', 'service_crashed', 'service_recovered',
           'schedule_start', 'schedule_stop', 'manual_start', 'manual_stop',
           'memory_shed', 'sync_completed', 'config_changed', 'decommissioned', 'reactivated'],
  }).notNull(),
  detail: text('detail'),                     // Human-readable description
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const windlassConfig = sqliteTable('windlass_config', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  endpointUrl: text('endpoint_url').notNull(), // e.g. http://localhost:8116
  syncIntervalSeconds: integer('sync_interval_seconds').notNull().default(60),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastSyncStatus: text('last_sync_status'),    // 'ok' | error message
  lastWeeklyDigestAt: integer('last_weekly_digest_at', { mode: 'timestamp' }),
  n8nWorkflowWindowsJson: text('n8n_workflow_windows_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- Feature Requests ---

export const featureRequests = sqliteTable('feature_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category', {
    enum: ['feature', 'improvement', 'integration', 'bug', 'other'],
  }).notNull().default('feature'),
  status: text('status', {
    enum: ['submitted', 'reviewing', 'planned', 'in_progress', 'shipped', 'declined'],
  }).notNull().default('submitted'),
  adminNotes: text('admin_notes'),         // Internal notes (not shown to user)
  responseToUser: text('response_to_user'), // Visible response to submitter
  votes: integer('votes').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// --- Windlass Alert Router ---

export const alertChannels = sqliteTable('alert_channels', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type', {
    enum: ['email', 'telegram', 'webhook'],
  }).notNull(),
  name: text('name').notNull(),                // User-friendly label
  config: text('config').notNull(),            // JSON: {email}, {bot_token, chat_id}, {url, secret}
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  serviceId: text('service_id'),               // NULL = global (all services)
  channelId: text('channel_id').notNull(),
  severityMin: text('severity_min', {
    enum: ['info', 'warning', 'critical'],
  }).notNull().default('warning'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const alertEvents = sqliteTable('alert_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  serviceId: text('service_id'),
  eventType: text('event_type').notNull(),     // service_down | service_up | health_degraded | cve_found | image_update
  severity: text('severity', {
    enum: ['info', 'warning', 'critical'],
  }).notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  suppressed: integer('suppressed', { mode: 'boolean' }).notNull().default(false),
  suppressionReason: text('suppression_reason'), // outside_schedule | flap_suppression | manual_mute | override_active
  channelsNotified: text('channels_notified'),   // JSON array of channel IDs
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- AI Provider Keys (BYOK) ---

export const aiProviderKeys = sqliteTable('ai_provider_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(),         // anthropic | openai | gemini
  encryptedApiKey: text('encrypted_api_key').notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  status: text('status', {
    enum: ['active', 'invalid', 'revoked'],
  }).notNull().default('active'),
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
    enum: ['user_key', 'ollama'],
  }).notNull(),
  outcome: text('outcome', {
    enum: ['success', 'failed', 'blocked'],
  }).notNull(),
  failureReason: text('failure_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const stackImports = sqliteTable('stack_imports', {
  id: text('id').primaryKey(),
  rawJson: text('raw_json').notNull(),
  renderedMarkdown: text('rendered_markdown').notNull(),
  status: text('status', {
    enum: ['pending', 'confirmed', 'discarded'],
  }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- Comms Channels: Multi-channel communication layer ---

export const commsChannels = sqliteTable('comms_channels', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  channelType: text('channel_type', {
    enum: ['slack', 'sms', 'webhook', 'email', 'websocket'],
  }).notNull(),
  name: text('name').notNull(), // User-friendly name: "Sonique", "Team Slack", etc.
  config: text('config').notNull(), // JSON: credentials, callback URLs, phone numbers, etc.
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const commsMessages = sqliteTable('comms_messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(), // FK to comms_channels
  direction: text('direction', {
    enum: ['inbound', 'outbound'],
  }).notNull(),
  content: text('content').notNull(), // The actual message text
  metadata: text('metadata'), // JSON: response time, tokens used, query results, etc.
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
});
