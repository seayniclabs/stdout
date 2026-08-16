-- Add parent_host_id to discovered_hosts table
ALTER TABLE discovered_hosts ADD COLUMN parent_host_id TEXT;
