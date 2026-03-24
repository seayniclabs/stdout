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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- Tenant Preferences: branding, display settings ---

export const tenantPreferences = sqliteTable('tenant_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceName: text('workspace_name'), // Replaces "StdOut" in nav
  accentColor: text('accent_color'), // Hex color override (e.g. #3B82F6)
  logoUrl: text('logo_url'), // Small image URL or data URI
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
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
    enum: ['http', 'tcp', 'docker', 'ping', 'dns'],
  }).notNull(),
  target: text('target').notNull(),        // URL, host:port, container name
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

export const stackImports = sqliteTable('stack_imports', {
  id: text('id').primaryKey(),
  rawJson: text('raw_json').notNull(),
  renderedMarkdown: text('rendered_markdown').notNull(),
  status: text('status', {
    enum: ['pending', 'confirmed', 'discarded'],
  }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
