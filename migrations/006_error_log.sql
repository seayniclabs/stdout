-- Error Log Table
-- Stores all errors for analytics and debugging

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  code TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT, -- JSON
  resolved BOOLEAN DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_error_log_code ON error_log(code);
CREATE INDEX IF NOT EXISTS idx_error_log_correlation ON error_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_error_log_severity ON error_log(severity);
CREATE INDEX IF NOT EXISTS idx_error_log_resolved ON error_log(resolved);
