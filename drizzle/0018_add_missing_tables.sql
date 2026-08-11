-- Phase 1.1: Add missing tables from TypeScript schemas that were never created in base migration

-- agent_config table (from agent-schema.ts)
CREATE TABLE `agent_config` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_name` text DEFAULT 'Riggins' NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text,
	`model` text NOT NULL,
	`api_key` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`proactive_notifications` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- agent_conversations table (from agent-schema.ts) - CRITICAL
CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- email_verifications table (from schema.ts)
CREATE TABLE `email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- password_resets table (from schema.ts)
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- user_settings table (from schema.ts)
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- user_skin_preferences table (from schema.ts)
CREATE TABLE `user_skin_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`skin_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- skins table (from schema.ts)
CREATE TABLE `skins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`css_url` text NOT NULL,
	`preview_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint

-- doc_chunks table (from observatory-schema.ts) - CRITICAL
CREATE TABLE `doc_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`embedding` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `docs`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- incident_occurrences table (from monitoring-schema.ts)
CREATE TABLE `incident_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`monitor_id` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE set null
);
--> statement-breakpoint

-- incidents_updated table (from monitoring-schema.ts)
CREATE TABLE `incidents_updated` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`field_changed` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- remediation_playbooks table (from observatory-schema.ts)
CREATE TABLE `remediation_playbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`steps` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint

-- remediation_executions table (from observatory-schema.ts)
CREATE TABLE `remediation_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`playbook_id` text NOT NULL,
	`incident_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`playbook_id`) REFERENCES `remediation_playbooks`(`id`) ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE set null
);
--> statement-breakpoint

-- remediation_execution_steps table (from observatory-schema.ts)
CREATE TABLE `remediation_execution_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`command` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`output` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`execution_id`) REFERENCES `remediation_executions`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- comms_channels table (if exists in schema)
CREATE TABLE IF NOT EXISTS `comms_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint

-- comms_messages table (if exists in schema)
CREATE TABLE IF NOT EXISTS `comms_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`message` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `comms_channels`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- collector_configs table (if exists in schema)
CREATE TABLE IF NOT EXISTS `collector_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint

-- cost_audit table (if exists in schema)
CREATE TABLE IF NOT EXISTS `cost_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`operation` text NOT NULL,
	`cost` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint

-- data_source_events table (if exists in schema)
CREATE TABLE IF NOT EXISTS `data_source_events` (
	`id` text PRIMARY KEY NOT NULL,
	`data_source_id` text NOT NULL,
	`event_type` text NOT NULL,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON DELETE cascade
);
