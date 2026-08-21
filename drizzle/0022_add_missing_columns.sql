-- Migration 0022: Add missing columns to monitors, discovered_hosts, and api_tokens tables

-- 1. monitors table: config for JSON monitor-specific settings
ALTER TABLE `monitors` ADD COLUMN `config` text;
--> statement-breakpoint

-- 2. discovered_hosts table: connection tracking and credentials
ALTER TABLE `discovered_hosts` ADD COLUMN `connection_status` text DEFAULT 'discovered';
--> statement-breakpoint
ALTER TABLE `discovered_hosts` ADD COLUMN `connection_attempted_at` integer;
--> statement-breakpoint
ALTER TABLE `discovered_hosts` ADD COLUMN `connection_error` text;
--> statement-breakpoint
ALTER TABLE `discovered_hosts` ADD COLUMN `credentials` text;
--> statement-breakpoint
ALTER TABLE `discovered_hosts` ADD COLUMN `ignore_reason` text;
--> statement-breakpoint
ALTER TABLE `discovered_hosts` ADD COLUMN `ignored_at` integer;
--> statement-breakpoint

-- 3. api_tokens table: user_id for associating tokens with users
ALTER TABLE `api_tokens` ADD COLUMN `user_id` text;
