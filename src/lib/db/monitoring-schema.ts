import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Import shared tables from tenant-schema (canonical source)
import {
  stacks,
  discoveredHosts,
  discoveredServices,
  incidents,
  resolutions,
  diagnoses,
  monitors,
  checkResults,
  uptimeDaily,
} from './tenant-schema';

// Re-export for backwards compatibility with existing imports
export {
  stacks,
  discoveredHosts,
  discoveredServices,
  incidents,
  resolutions,
  diagnoses,
  monitors,
  checkResults,
  uptimeDaily,
};

// --- UNIQUE TO MONITORING-SCHEMA ---

export const incidentOccurrences = sqliteTable('incident_occurrences', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
});

export const incidents_updated = sqliteTable('incidents_updated', {
  // This is a marker table to track that cost columns were added to incidents
  // The actual columns are in the incidents table migration
  id: text('id').primaryKey(),
  migrationVersion: integer('migration_version').notNull().default(1),
});
