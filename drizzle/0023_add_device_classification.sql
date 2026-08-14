-- Add device_classification column to discovered_hosts
ALTER TABLE discovered_hosts ADD COLUMN device_classification TEXT;
CREATE INDEX IF NOT EXISTS idx_discovered_hosts_classification ON discovered_hosts(device_classification);
