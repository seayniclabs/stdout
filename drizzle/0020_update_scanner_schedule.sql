ALTER TABLE scanner_schedule ADD COLUMN interval TEXT NOT NULL DEFAULT 'daily';--> statement-breakpoint
ALTER TABLE scanner_schedule ADD COLUMN hour INTEGER NOT NULL DEFAULT 3;--> statement-breakpoint
ALTER TABLE scanner_schedule ADD COLUMN minute INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE scanner_schedule ADD COLUMN weekday INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE scanner_schedule ADD COLUMN modules TEXT NOT NULL DEFAULT '["docker","metrics"]';--> statement-breakpoint
ALTER TABLE scanner_schedule ADD COLUMN subnets TEXT;--> statement-breakpoint
ALTER TABLE scanner_schedule ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'));
