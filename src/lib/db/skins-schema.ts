import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ============================================================================
// SKINS & THEMING SCHEMA
// ============================================================================
// Implements F006: Theming and Skins System
//
// Skins are JSON documents containing CSS variable values. The system applies
// a selected skin by injecting its CSS variables into the :root element.
//
// Each user can have one active skin. Skins can be:
// - Built-in (shipped with StdOut)
// - User-created (via the skin editor)
// - Community-imported (from stdout.seayniclabs.com/skins)
// ============================================================================

export const skins = sqliteTable('skins', {
  id: text('id').primaryKey(),
  userId: text('user_id'), // null for built-in skins
  name: text('name').notNull(),
  description: text('description'),
  author: text('author'), // Display name or email
  version: text('version').notNull().default('1.0.0'),
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false), // Can be shared

  // Skin content - JSON object containing CSS variable values
  // Structure defined in skin.schema.json
  colors: text('colors').notNull(), // JSON: color variables
  typography: text('typography'), // JSON: font families, sizes, weights
  spacing: text('spacing'), // JSON: radius, spacing tokens
  shadows: text('shadows'), // JSON: shadow definitions
  effects: text('effects'), // JSON: blur, opacity, transitions

  // Preview metadata
  thumbnail: text('thumbnail'), // Base64-encoded preview image or URL
  tags: text('tags'), // Comma-separated: dark, light, high-contrast, colorful, minimal

  // Usage tracking
  installCount: integer('install_count').notNull().default(0), // For community skins

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const userSkinPreferences = sqliteTable('user_skin_preferences', {
  userId: text('user_id').primaryKey(),
  activeSkinId: text('active_skin_id'), // null = default skin
  customOverrides: text('custom_overrides'), // JSON: user's ad-hoc CSS variable overrides
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
