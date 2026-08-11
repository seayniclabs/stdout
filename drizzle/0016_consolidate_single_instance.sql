CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT 'instance',
  workspace_name TEXT DEFAULT 'StdOut',
  accent_color TEXT DEFAULT '#F97316',
  logo_url TEXT,
  onboarding_progress TEXT,
  onboarding_dismissed INTEGER DEFAULT 0,
  addons_dismissed INTEGER DEFAULT 0,
  addons_hidden INTEGER DEFAULT 0,
  addons_cache TEXT,
  addons_cache_at INTEGER,
  operating_mode TEXT DEFAULT 'discover',
  autopilot_enabled INTEGER DEFAULT 0,
  autopilot_level TEXT DEFAULT 'discover',
  autopilot_success_count INTEGER DEFAULT 0,
  autopilot_fail_count INTEGER DEFAULT 0,
  autopilot_level_since INTEGER,
  killswitch_tripped INTEGER DEFAULT 0,
  killswitch_reason TEXT,
  killswitch_at INTEGER,
  god_mode_granted INTEGER DEFAULT 0,
  god_mode_granted_by TEXT,
  god_mode_granted_at INTEGER,
  rag_include_public INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tenant_preferences (
  id INTEGER PRIMARY KEY,
  workspace_name TEXT,
  accent_color TEXT,
  logo_url TEXT,
  onboarding_progress TEXT,
  onboarding_dismissed INTEGER,
  addons_dismissed INTEGER,
  addons_hidden INTEGER,
  addons_cache TEXT,
  addons_cache_at INTEGER,
  operating_mode TEXT,
  autopilot_enabled INTEGER,
  autopilot_level TEXT,
  autopilot_success_count INTEGER,
  autopilot_fail_count INTEGER,
  autopilot_level_since INTEGER,
  killswitch_tripped INTEGER,
  killswitch_reason TEXT,
  killswitch_at INTEGER,
  god_mode_granted INTEGER,
  god_mode_granted_by TEXT,
  god_mode_granted_at INTEGER,
  rag_include_public INTEGER,
  updated_at INTEGER
);
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings (
  workspace_name, accent_color, logo_url, onboarding_progress,
  onboarding_dismissed, addons_dismissed, addons_hidden, addons_cache, addons_cache_at,
  operating_mode, autopilot_enabled, autopilot_level,
  autopilot_success_count, autopilot_fail_count, autopilot_level_since,
  killswitch_tripped, killswitch_reason, killswitch_at,
  god_mode_granted, god_mode_granted_by, god_mode_granted_at,
  rag_include_public, updated_at
)
SELECT
  workspace_name, accent_color, logo_url, onboarding_progress,
  onboarding_dismissed, addons_dismissed, addons_hidden, addons_cache, addons_cache_at,
  operating_mode, autopilot_enabled, autopilot_level,
  autopilot_success_count, autopilot_fail_count, autopilot_level_since,
  killswitch_tripped, killswitch_reason, killswitch_at,
  god_mode_granted, god_mode_granted_by, god_mode_granted_at,
  rag_include_public, updated_at
FROM tenant_preferences
ORDER BY id
LIMIT 1;
--> statement-breakpoint
DROP TABLE IF EXISTS tenant_preferences;


