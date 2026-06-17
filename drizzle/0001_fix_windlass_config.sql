DROP TABLE IF EXISTS windlass_config;

CREATE TABLE `windlass_config` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `endpoint_url` text NOT NULL,
  `sync_interval_seconds` integer DEFAULT 60 NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `last_synced_at` integer,
  `last_sync_status` text,
  `last_weekly_digest_at` integer,
  `n8n_workflow_windows_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
