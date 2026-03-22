import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// --- Central DB: auth, billing, API tokens, audit ---
// Lives in data/central.db (SaaS) or data/stdout.db (self-host)

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  subscriptionStatus: text('subscription_status', {
    enum: ['active', 'free', 'past_due', 'expired', 'none'],
  }).notNull().default('none'),
  subscriptionTier: text('subscription_tier', {
    enum: ['solo', 'shop', 'self-host'],
  }),
  subscriptionPeriodEnd: integer('subscription_period_end', { mode: 'timestamp' }),
  role: text('role', {
    enum: ['superadmin', 'admin', 'member'],
  }).notNull().default('member'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),
  oidcSub: text('oidc_sub'),
  stripeCustomerId: text('stripe_customer_id'),
  privacyAcceptedAt: integer('privacy_accepted_at', { mode: 'timestamp' }),
  dpaAcceptedAt: integer('dpa_accepted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
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
  details: text('details'), // JSON context
  ip: text('ip'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// --- Team / RBAC (Shop tier) ---

export const teamMembers = sqliteTable('team_members', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // null until accepted
  email: text('email').notNull(), // invited email
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
