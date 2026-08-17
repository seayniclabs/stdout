-- Migration: Add missing columns to discovered_hosts table
-- Date: 2026-08-17
-- Issue: Discovery worker was failing to save network hosts because columns didn't exist

-- Add device_type column
ALTER TABLE discovered_hosts ADD COLUMN device_type TEXT;

-- Add open_ports column (JSON array)
ALTER TABLE discovered_hosts ADD COLUMN open_ports TEXT;

-- Add services column (JSON array)
ALTER TABLE discovered_hosts ADD COLUMN services TEXT;

-- Add os_guess column
ALTER TABLE discovered_hosts ADD COLUMN os_guess TEXT;

-- Add discovered_at timestamp
ALTER TABLE discovered_hosts ADD COLUMN discovered_at INTEGER;
