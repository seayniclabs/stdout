import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// --- COMMUNITY LIBRARY ---

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
