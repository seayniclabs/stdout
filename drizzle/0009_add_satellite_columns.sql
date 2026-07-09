-- Add missing columns to satellite_agents to support telemetry and alerting.
ALTER TABLE `satellite_agents` ADD `last_seen` integer;
--> statement-breakpoint
ALTER TABLE `satellite_agents` ADD `last_report` text;
--> statement-breakpoint
ALTER TABLE `satellite_agents` ADD `alert_state` text NOT NULL DEFAULT 'ok';
--> statement-breakpoint
ALTER TABLE `satellite_agents` ADD `tags` text NOT NULL DEFAULT '[]';
