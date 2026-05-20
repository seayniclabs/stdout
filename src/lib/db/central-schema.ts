import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role', {
    enum: ['superadmin', 'admin', 'member'],
  }).notNull().default('member'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),
  privacyAcceptedAt: integer('privacy_accepted_at', { mode: 'timestamp' }),
  dpaAcceptedAt: integer('dpa_accepted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const license = sqliteTable('license', {
  key: text('key').primaryKey(),
  email: text('email').notNull(),
  edition: text('edition').notNull().default('self-host'),
  activatedAt: integer('activated_at', { mode: 'timestamp' }).notNull(),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const passwordResets = sqliteTable('password_resets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const emailVerifications = sqliteTable('email_verifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  details: text('details'),
  ip: text('ip'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const teamMembers = sqliteTable('team_members', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role', {
    enum: ['admin', 'editor', 'viewer'],
  }).notNull().default('viewer'),
  status: text('status', {
    enum: ['pending', 'accepted', 'revoked'],
  }).notNull().default('pending'),
  invitedAt: integer('invited_at', { mode: 'timestamp' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
});

export const deletions = sqliteTable('deletions', {
  id: text('id').primaryKey(),
  emailHash: text('email_hash').notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }).notNull(),
});

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
