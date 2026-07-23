ALTER TABLE `incidents` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `incidents` ADD `duplicate_of` text;--> statement-breakpoint
ALTER TABLE `incidents` ADD `occurrence_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `cost_impact` real;--> statement-breakpoint
ALTER TABLE `incidents` ADD `attachments` text;