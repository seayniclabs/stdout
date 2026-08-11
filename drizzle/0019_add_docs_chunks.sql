-- Add missing columns to docs table
ALTER TABLE docs ADD COLUMN chunks TEXT;
--> statement-breakpoint
ALTER TABLE docs ADD COLUMN embeddings TEXT;
