import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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
  lastRun: integer('last_run', { mode: 'timestamp' }),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const dataSourceEvents = sqliteTable('data_source_events', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(),
  type: text('type').notNull(),
  attributes: text('attributes').notNull(), // JSON
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  sourceId: text('source_id'),
  sourceType: text('source_type').notNull(),
});
