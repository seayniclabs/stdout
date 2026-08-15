-- Add parent_host_id column to discovered_hosts for Docker container tracking
ALTER TABLE discovered_hosts ADD COLUMN parent_host_id TEXT;
