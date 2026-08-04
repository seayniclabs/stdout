import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// --- SATELLITE AGENTS & REPORTING ---

export const satelliteAgents = sqliteTable('satellite_agents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  hostname: text('hostname').notNull(),
  ipAddress: text('ip_address').notNull(),
  apiKey: text('api_key').notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastSeen: integer('last_seen'),
  lastReport: text('last_report'),
  alertState: text('alert_state').notNull().default('ok'),
  tags: text('tags').notNull().default('[]'),
});

export const satelliteReports = sqliteTable('satellite_reports', {
  id: text('id').primaryKey(),
  satelliteId: text('satellite_id').notNull(),
  userId: text('user_id').notNull(),
  metrics: text('metrics').notNull(), // JSON
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
});
