-- Rebuild scanner_schedule table with new schema only
-- SQLite doesn't support DROP COLUMN, so we create new table and copy data

CREATE TABLE scanner_schedule_new (
	id TEXT PRIMARY KEY NOT NULL,
	interval TEXT NOT NULL DEFAULT 'daily',
	hour INTEGER NOT NULL DEFAULT 3,
	minute INTEGER NOT NULL DEFAULT 0,
	weekday INTEGER NOT NULL DEFAULT 0,
	enabled INTEGER NOT NULL DEFAULT 1,
	modules TEXT NOT NULL DEFAULT '["docker","metrics"]',
	subnets TEXT,
	updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);--> statement-breakpoint
INSERT INTO scanner_schedule_new (id, interval, hour, minute, weekday, enabled, modules, subnets, updated_at)
SELECT id, interval, hour, minute, weekday, enabled, modules, subnets, updated_at
FROM scanner_schedule;--> statement-breakpoint
DROP TABLE scanner_schedule;--> statement-breakpoint
ALTER TABLE scanner_schedule_new RENAME TO scanner_schedule;
