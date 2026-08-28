-- Migration 0023: Add missing columns from Phase 1.1 multi-tenant removal
-- Adds columns that exist in TypeScript schemas but were accidentally removed from SQL

-- docs table: add chunks and embeddings columns (Phase 3.1 Open-Notebook RAG)
ALTER TABLE `docs` ADD COLUMN `chunks` text;
ALTER TABLE `docs` ADD COLUMN `embeddings` text;

-- satellite_agents table: add missing columns
ALTER TABLE `satellite_agents` ADD COLUMN `last_seen` integer;
ALTER TABLE `satellite_agents` ADD COLUMN `last_report` text;
ALTER TABLE `satellite_agents` ADD COLUMN `alert_state` text NOT NULL DEFAULT 'ok';
ALTER TABLE `satellite_agents` ADD COLUMN `tags` text NOT NULL DEFAULT '[]';
