import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { users } from './central-schema';

// NOTE: users and sessions tables are defined in central-schema.ts
// Do not duplicate them here - import instead

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(), // Required: tokens must expire
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

