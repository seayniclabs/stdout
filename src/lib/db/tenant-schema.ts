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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
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
