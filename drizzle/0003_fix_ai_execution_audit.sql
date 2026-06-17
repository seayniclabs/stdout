-- Migration to fix ai_execution_audit schema mismatch
-- The code uses incidentId/capability/outcome/failureReason
-- but the schema had relatedId/executionType/status/errorMessage

-- Drop and recreate the table with correct columns
DROP TABLE IF EXISTS ai_execution_audit;--> statement-breakpoint
CREATE TABLE `ai_execution_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `incident_id` text,
  `capability` text NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `credential_source` text NOT NULL,
  `outcome` text NOT NULL,
  `failure_reason` text,
  `created_at` integer NOT NULL
);
