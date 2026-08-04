import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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
