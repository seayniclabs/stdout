import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { users } from './central-schema';

// --- ENTITY GRAPH ---

export const entities = sqliteTable('entities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['host', 'container', 'service', 'network', 'switch', 'router', 'device'],
  }).notNull(),
  name: text('name').notNull(),
  properties: text('properties', { mode: 'json' }), // JSON blob for flexible metadata
  discoveredAt: integer('discovered_at', { mode: 'timestamp' }).notNull(),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const entityRelationships = sqliteTable('entity_relationships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['runs_on', 'connects_to', 'depends_on', 'part_of', 'serves'],
  }).notNull(),
  metadata: text('metadata', { mode: 'json' }), // Optional relationship metadata (port, protocol, etc.)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
