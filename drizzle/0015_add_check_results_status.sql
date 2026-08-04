CREATE TABLE check_results_new (
  id TEXT PRIMARY KEY NOT NULL,
  monitor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'healthy',
  response_time_ms INTEGER,
  status_code INTEGER,
  error TEXT,
  checked_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO check_results_new (id, monitor_id, status, response_time_ms, status_code, error, checked_at)
SELECT
  id,
  monitor_id,
  CASE
    WHEN success = 1 THEN 'healthy'
    WHEN success = 0 AND error IS NOT NULL THEN 'down'
    ELSE 'degraded'
  END as status,
  response_time as response_time_ms,
  status_code,
  error,
  checked_at
FROM check_results;
--> statement-breakpoint
DROP TABLE check_results;
--> statement-breakpoint
ALTER TABLE check_results_new RENAME TO check_results;
