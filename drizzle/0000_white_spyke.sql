CREATE TABLE `addon_interest` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`product_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_execution_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`related_id` text,
	`execution_type` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`credential_source` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_provider_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`key_fingerprint` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`diagnostics_model` text,
	`autofix_model` text,
	`platform_fallback` integer DEFAULT true NOT NULL,
	`last_validated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`alert_rule_id` text NOT NULL,
	`monitor_id` text,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`monitor_id` text,
	`name` text NOT NULL,
	`condition` text NOT NULL,
	`threshold` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`details` text,
	`ip` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `check_results` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`user_id` text NOT NULL,
	`success` integer NOT NULL,
	`response_time` integer,
	`status_code` integer,
	`error` text,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`original_doc_id` text NOT NULL,
	`sanitized_title` text NOT NULL,
	`sanitized_content` text NOT NULL,
	`doc_type` text DEFAULT 'note' NOT NULL,
	`tags` text,
	`sanitization_log` text,
	`value_score` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer
);
--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`username` text,
	`password_hash` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`root_causes` text NOT NULL,
	`suggested_commands` text,
	`matched_incident_ids` text,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`tool_used` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `discovered_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stack_id` text,
	`ip_address` text NOT NULL,
	`hostname` text,
	`mac_address` text,
	`vendor` text,
	`last_seen` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovered_hosts_ip_address_unique` ON `discovered_hosts` (`ip_address`);--> statement-breakpoint
CREATE TABLE `discovered_services` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`user_id` text NOT NULL,
	`port` integer NOT NULL,
	`protocol` text DEFAULT 'tcp' NOT NULL,
	`service_name` text,
	`service_version` text,
	`last_seen` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `doc_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`user_id` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `docs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`tags` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `docs_slug_unique` ON `docs` (`slug`);--> statement-breakpoint
CREATE TABLE `feature_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text,
	`votes` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stack_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`tags` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `license` (
	`key` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`edition` text DEFAULT 'self-host' NOT NULL,
	`activated_at` integer NOT NULL,
	`last_checked_at` integer
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`interval_seconds` integer DEFAULT 60 NOT NULL,
	`timeout_ms` integer DEFAULT 5000 NOT NULL,
	`expected_status` integer,
	`retries` integer DEFAULT 3 NOT NULL,
	`stack_id` text,
	`paused` integer DEFAULT false NOT NULL,
	`maintenance` integer DEFAULT false NOT NULL,
	`current_status` text DEFAULT 'unknown' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_checked_at` integer,
	`last_response_ms` integer,
	`json_path` text,
	`freshness_window_seconds` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`event_type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observatory_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_type` text NOT NULL,
	`incident_id` text,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`outcome` text NOT NULL,
	`execution_time_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observatory_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`stack_id` text NOT NULL,
	`metric_name` text NOT NULL,
	`mean` real NOT NULL,
	`std_dev` real NOT NULL,
	`sample_count` integer NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observatory_custom_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`pattern` text NOT NULL,
	`description` text NOT NULL,
	`suggested_commands` text,
	`prevention_steps` text,
	`severity` text DEFAULT 'medium' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observatory_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`diagnosis_id` text,
	`feedback_type` text NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observatory_pending_fixes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`fix_type` text NOT NULL,
	`fix_command` text NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_by` text,
	`applied_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observatory_standard_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern_name` text NOT NULL,
	`category` text NOT NULL,
	`symptoms` text NOT NULL,
	`common_causes` text NOT NULL,
	`resolution_steps` text NOT NULL,
	`prevention_steps` text,
	`confidence_threshold` real NOT NULL,
	`source` text DEFAULT 'stdlib' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `satellite_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`hostname` text NOT NULL,
	`ip_address` text NOT NULL,
	`api_key` text NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `satellite_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`satellite_id` text NOT NULL,
	`user_id` text NOT NULL,
	`metrics` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scanner_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scan_type` text NOT NULL,
	`target` text NOT NULL,
	`schedule` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `setup_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`step_number` integer NOT NULL,
	`step_name` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stack_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`stack_id` text,
	`imported_data` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stacks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`previous_description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `status_page` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`slug` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `status_page_slug_unique` ON `status_page` (`slug`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tenant_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_name` text,
	`accent_color` text,
	`logo_url` text,
	`onboarding_progress` text,
	`onboarding_dismissed` integer DEFAULT false NOT NULL,
	`addons_dismissed` integer DEFAULT false NOT NULL,
	`addons_hidden` integer DEFAULT false NOT NULL,
	`addons_cache` text,
	`addons_cache_at` integer,
	`operating_mode` text DEFAULT 'discover' NOT NULL,
	`autopilot_enabled` integer DEFAULT false NOT NULL,
	`autopilot_level` text DEFAULT 'discover' NOT NULL,
	`autopilot_success_count` integer DEFAULT 0 NOT NULL,
	`autopilot_fail_count` integer DEFAULT 0 NOT NULL,
	`autopilot_level_since` integer,
	`killswitch_tripped` integer DEFAULT false NOT NULL,
	`killswitch_reason` text,
	`killswitch_at` integer,
	`god_mode_granted` integer DEFAULT false NOT NULL,
	`god_mode_granted_by` text,
	`god_mode_granted_at` integer,
	`rag_include_public` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticketing_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text DEFAULT 'incident' NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`stack_id` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`due_date` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `unknown_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uptime_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`avg_response_time` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `windlass_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `windlass_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service_id` text NOT NULL,
	`event_type` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `windlass_services` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
