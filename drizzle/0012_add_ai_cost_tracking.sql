ALTER TABLE `incidents` ADD `ai_cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `ai_tokens_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `ai_provider` text;