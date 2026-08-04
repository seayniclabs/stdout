ALTER TABLE check_results ADD COLUMN status TEXT NOT NULL DEFAULT 'healthy';
--> statement-breakpoint
ALTER TABLE check_results ADD COLUMN response_time_ms INTEGER;
--> statement-breakpoint
UPDATE check_results SET status = CASE
  WHEN success = 1 THEN 'healthy'
  WHEN success = 0 AND error IS NOT NULL THEN 'down'
  ELSE 'degraded'
END;
--> statement-breakpoint
ALTER TABLE check_results DROP COLUMN user_id;
--> statement-breakpoint
ALTER TABLE check_results DROP COLUMN success;
--> statement-breakpoint
ALTER TABLE check_results DROP COLUMN response_time;
