-- Allow system-level Windlass events (Suricata ingest, sync_completed) without a service_id.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__windlass_events_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service_id` text,
	`event_type` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__windlass_events_new` (`id`, `user_id`, `service_id`, `event_type`, `details`, `created_at`)
SELECT `id`, `user_id`, `service_id`, `event_type`, `details`, `created_at` FROM `windlass_events`;
--> statement-breakpoint
DROP TABLE `windlass_events`;
--> statement-breakpoint
ALTER TABLE `__windlass_events_new` RENAME TO `windlass_events`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
