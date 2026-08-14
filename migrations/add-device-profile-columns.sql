-- Add rich device profiling columns to discovered_hosts
ALTER TABLE discovered_hosts ADD COLUMN open_ports TEXT;  -- JSON array of port numbers
ALTER TABLE discovered_hosts ADD COLUMN services TEXT;    -- JSON array of service objects
ALTER TABLE discovered_hosts ADD COLUMN os_guess TEXT;    -- OS fingerprint guess
ALTER TABLE discovered_hosts ADD COLUMN device_classification TEXT;  -- Refined device type

-- Create index for device type queries
CREATE INDEX IF NOT EXISTS idx_discovered_hosts_device_type ON discovered_hosts(device_type);
CREATE INDEX IF NOT EXISTS idx_discovered_hosts_classification ON discovered_hosts(device_classification);
