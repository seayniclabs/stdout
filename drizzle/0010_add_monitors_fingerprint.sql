-- Add fingerprint column to monitors table for deduplication
ALTER TABLE monitors ADD COLUMN fingerprint TEXT;
