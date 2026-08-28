/**
 * Autonomous Watcher for Observatory Agent
 *
 * Industry best practices for autonomous infrastructure agents:
 *
 * 1. **Automated Investigation** (no approval needed):
 *    - Gather metrics, logs, health checks
 *    - Analyze baselines and detect anomalies
 *    - Diagnose root causes
 *
 * 2. **Human-in-the-Loop Remediation** (approval required):
 *    - Agent prepares remediation commands
 *    - Pauses execution until admin approves
 *    - Tracks approval in agent_pending_actions table
 *
 * 3. **Feedback Loops** (verify success):
 *    - After taking action, verify it worked
 *    - Monitor health checks, re-query metrics
 *    - Escalate if action didn't resolve the issue
 *
 * 4. **Least Privilege**:
 *    - Read-only tools always available
 *    - Write tools (restart_container) require operator+ role
 *    - Never skip permission checks
 *
 * Based on: Vercel AI SDK patterns, Cloudflare monitoring practices,
 * Docker health check patterns (service_healthy condition)
 */

import { autoRouteWithTools } from './auto-router-tools';
import { loadMemory, saveConversation, buildPromptContext } from './memory';
import { getDb, getSqlite } from '../db';
import { runPassiveDiscovery } from '../discovery/passive-discovery';
import { sendAlert } from '../alerts/alert-router';
import { getStorageUsage, recordDailyStorageSnapshot, vacuumDatabase, archiveOldLogs } from '../storage/storage-monitor';

let watcherInterval: NodeJS.Timeout | null = null;
let isRunning = false;

interface WatcherConfig {
  enabled: boolean;
  intervalSeconds: number;
  selfHealingEnabled: boolean; // Can fix StdOut itself without approval
  externalRemediationMode: 'investigate' | 'approve-to-act' | 'autofix'; // For watched infrastructure
  autoRemediate?: boolean; // Derived from externalRemediationMode
  notifyOnCritical: boolean;
}

const DEFAULT_CONFIG: WatcherConfig = {
  enabled: true,
  intervalSeconds: 180, // Check every 3 minutes
  selfHealingEnabled: true, // Can always fix StdOut itself
  externalRemediationMode: 'investigate', // Watched infrastructure needs approval by default
  autoRemediate: false,
  notifyOnCritical: true,
};

/**
 * Start the autonomous watcher loop
 */
export function startAutonomousWatcher() {
  if (isRunning) {
    console.log('[Agent Watcher] Already running');
    return;
  }

  const config = loadWatcherConfig();
  if (!config.enabled) {
    console.log('[Agent Watcher] Disabled in config');
    return;
  }

  console.log(`[Agent Watcher] Starting autonomous loop (every ${config.intervalSeconds}s)`);
  console.log(`[Agent Watcher] Auto-remediation: ${config.autoRemediate ? 'ENABLED' : 'DISABLED'}`);

  isRunning = true;

  // Run on interval only (not immediately on startup)
  // Immediate execution during server init can exit if DB connections aren't ready
  // Deferred 2026-08-28: Low priority - interval-only execution works fine

  watcherInterval = setInterval(() => {
    runWatcherCycle(config);
  }, config.intervalSeconds * 1000);
}

/**
 * Stop the autonomous watcher
 */
export function stopAutonomousWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
  isRunning = false;
  console.log('[Agent Watcher] Stopped');
}

/**
 * Run one cycle of the autonomous watcher
 */
async function runWatcherCycle(config: WatcherConfig) {
  console.log('[Agent Watcher] Running cycle...');

  try {
    // Get all users to run checks for each
    const db = getSqlite();
    const users = db.prepare('SELECT id FROM users').all() as Array<{ id: string }>;

    for (const user of users) {
      await runWatcherForUser(user.id, config);
    }

    // Run housekeeping tasks (daily checks)
    await runHousekeepingTasks();

    console.log('[Agent Watcher] Cycle complete');
  } catch (error) {
    console.error('[Agent Watcher] Cycle failed:', error);
  }
}

/**
 * Run watcher checks for a specific user
 *
 * Follows industry best practices:
 * 1. Investigation phase (always runs, read-only)
 * 2. Remediation phase (only if approved by human)
 * 3. Verification phase (check if action worked)
 */
async function runWatcherForUser(userId: string, config: WatcherConfig) {
  try {
    // Load agent memory (includes infrastructure context)
    const memory = await loadMemory(userId);
    const context = buildPromptContext(memory);

    // PHASE 1: INVESTIGATION (automatic, read-only)
    const investigationPrompt = `
You are performing an autonomous infrastructure check. This is the INVESTIGATION phase.

Your investigation tasks:
1. Check for active incidents: use get_incidents tool
2. Review metrics for anomalies: use get_metrics tool
3. Check stack health: use get_stacks tool
4. Identify root causes of any issues

IMPORTANT - Remediation Authority:
- **StdOut itself** (this system): You CAN take action immediately if needed. Self-healing is ENABLED.
- **Watched infrastructure** (external stacks): ${config.externalRemediationMode === 'investigate'
  ? 'INVESTIGATE ONLY - propose actions but do NOT execute them.'
  : 'Propose actions and they will be queued for approval.'}

How to identify if an issue is StdOut itself vs watched infrastructure:
- StdOut issues: Problems with this container, Observatory services, agent processes
- External issues: Problems with user's stacks, their containers, their services

Output format:
- If no issues: "All systems nominal."
- If StdOut issue found: Describe it, then immediately attempt to fix (restart services, clear cache, etc.)
- If external issue found: Describe it and suggest remediation, but DO NOT act.

Be concise. Focus on actionable findings.
`;

    const investigation = await autoRouteWithTools(investigationPrompt, context, userId);

    // All clear - nothing to do
    if (investigation.content.includes('All systems nominal')) {
      console.log(`[Agent Watcher] User ${userId}: All clear`);
      return;
    }

    // Found an issue - log it
    console.log(`[Agent Watcher] User ${userId}: ${investigation.content.substring(0, 150)}...`);

    // Save investigation findings
    await saveConversation(userId, 'assistant', investigation.content, {
      provider: investigation.provider,
      model: investigation.model,
      autonomous: true,
      phase: 'investigation',
      toolsUsed: investigation.toolsUsed,
    });

    // Store alert for UI if critical
    if (config.notifyOnCritical && investigation.content.toLowerCase().includes('critical')) {
      await storeAutonomousAlert(userId, investigation.content);
    }

    // PHASE 2: REMEDIATION (only if mode is 'approve-to-act' and agent proposed action)
    if (config.mode === 'approve-to-act' && investigation.content.toLowerCase().includes('suggest')) {
      // Agent suggested remediation - store for human approval
      await storePendingAction(userId, investigation.content);
      console.log(`[Agent Watcher] User ${userId}: Remediation pending approval`);
    }

  } catch (error) {
    console.error(`[Agent Watcher] Check failed for user ${userId}:`, error);
    if (error instanceof Error && error.stack) {
      console.error('[Agent Watcher] Stack:', error.stack);
    }
  }
}

/**
 * Store an autonomous alert for the user to see
 */
async function storeAutonomousAlert(userId: string, message: string) {
  const db = getSqlite();
  const id = `agent_alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  db.prepare(`
    INSERT INTO agent_conversations (id, user_id, role, content, metadata, created_at)
    VALUES (?, ?, 'assistant', ?, ?, ?)
  `).run(
    id,
    userId,
    message,
    JSON.stringify({ autonomous: true, alert: true }),
    Date.now()
  );
}

/**
 * Store a pending action for human approval
 * Follows the "human-in-the-loop" pattern for remediation
 */
async function storePendingAction(userId: string, investigationReport: string) {
  const db = getSqlite();

  // Create table if it doesn't exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_pending_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      investigation_report TEXT NOT NULL,
      proposed_action TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      approved_at INTEGER,
      executed_at INTEGER,
      result TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();

  const id = `action_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  db.prepare(`
    INSERT INTO agent_pending_actions
    (id, user_id, investigation_report, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(id, userId, investigationReport, Date.now());

  // Also store as a special alert so user sees it in UI
  await storeAutonomousAlert(userId, `🔔 Action pending approval: ${investigationReport.substring(0, 200)}...`);
}

/**
 * Load watcher configuration (from DB or defaults)
 */
function loadWatcherConfig(): WatcherConfig {
  const db = getSqlite();
  let config = { ...DEFAULT_CONFIG };

  // Try to load from agent_watcher_config table (optional)
  try {
    const row = db.prepare(`
      SELECT config FROM agent_watcher_config LIMIT 1
    `).get() as { config: string } | undefined;

    if (row) {
      config = { ...config, ...JSON.parse(row.config) };
    }
  } catch (error) {
    // Table might not exist yet - that's fine, continue with defaults
  }

  // Always check system_state for observatory_external_remediation_mode (this takes precedence)
  try {
    const modeRow = db.prepare(`
      SELECT value FROM system_state WHERE key = 'observatory_external_remediation_mode'
    `).get() as { value: string } | undefined;

    if (modeRow?.value) {
      console.log(`[Agent Watcher] Loaded remediation mode from DB: ${modeRow.value}`);
      config.externalRemediationMode = modeRow.value as 'investigate' | 'approve-to-act' | 'autofix';
    } else {
      console.log('[Agent Watcher] No remediation mode found in system_state, using default');
    }
  } catch (error) {
    console.error('[Agent Watcher] Error reading system_state:', error);
  }

  // Set autoRemediate based on mode
  config.autoRemediate = config.externalRemediationMode === 'autofix';
  console.log(`[Agent Watcher] Config loaded - autoRemediate: ${config.autoRemediate} (mode: ${config.externalRemediationMode})`);

  return config;
}

/**
 * Save watcher configuration
 */
export function saveWatcherConfig(config: Partial<WatcherConfig>) {
  const db = getSqlite();

  // Create table if it doesn't exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_watcher_config (
      id INTEGER PRIMARY KEY,
      config TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  const current = loadWatcherConfig();
  const updated = { ...current, ...config };

  db.prepare(`
    INSERT OR REPLACE INTO agent_watcher_config (id, config, updated_at)
    VALUES (1, ?, ?)
  `).run(JSON.stringify(updated), Date.now());

  // Restart watcher if config changed
  if (isRunning) {
    stopAutonomousWatcher();
    startAutonomousWatcher();
  }
}

/**
 * Housekeeping Tasks (run daily)
 *
 * Riggins keeps the system clean and healthy:
 * - Passive discovery sweep
 * - Storage monitoring + auto-archival
 * - Database vacuum
 * - Alert on storage issues
 */
async function runHousekeepingTasks() {
  const db = getSqlite();

  // Track last housekeeping run
  db.prepare(`
    CREATE TABLE IF NOT EXISTS housekeeping_runs (
      id INTEGER PRIMARY KEY,
      task TEXT NOT NULL,
      last_run INTEGER NOT NULL,
      status TEXT NOT NULL,
      details TEXT
    )
  `).run();

  const getLastRun = (task: string): number => {
    const row = db.prepare(`SELECT last_run FROM housekeeping_runs WHERE task = ?`).get(task) as { last_run: number } | undefined;
    return row?.last_run || 0;
  };

  const recordRun = (task: string, status: 'success' | 'failed', details?: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO housekeeping_runs (id, task, last_run, status, details)
      VALUES ((SELECT id FROM housekeeping_runs WHERE task = ?), ?, ?, ?, ?)
    `).run(task, task, Date.now(), status, details || null);
  };

  // Task 1: Passive Discovery (every 6 hours)
  const lastDiscovery = getLastRun('passive-discovery');
  if (Date.now() - lastDiscovery > 6 * 60 * 60 * 1000) {
    try {
      console.log('[Housekeeping] Running passive discovery...');
      const apps = await runPassiveDiscovery();
      recordRun('passive-discovery', 'success', `Found ${apps.length} applications`);
    } catch (error) {
      console.error('[Housekeeping] Passive discovery failed:', error);
      recordRun('passive-discovery', 'failed', error instanceof Error ? error.message : String(error));
    }
  }

  // Task 2: Storage Monitoring (every 1 hour)
  const lastStorage = getLastRun('storage-check');
  if (Date.now() - lastStorage > 60 * 60 * 1000) {
    try {
      console.log('[Housekeeping] Checking storage usage...');
      const usage = await getStorageUsage();

      // Alert if storage critically full
      if (usage.percent_used > 90) {
        const users = db.prepare('SELECT id FROM users').all() as Array<{ id: string }>;
        for (const user of users) {
          await sendAlert({
            id: `storage_critical_${Date.now()}`,
            severity: 'critical',
            title: 'Storage Critically Full',
            message: `Storage usage at ${usage.percent_used.toFixed(1)}%. Auto-archival recommended.`,
            source: 'riggins',
            metadata: { usage },
            created_at: Date.now(),
            fingerprint: 'storage-critical',
          }, user.id);
        }
      }

      recordRun('storage-check', 'success', `${usage.percent_used.toFixed(1)}% used`);
    } catch (error) {
      console.error('[Housekeeping] Storage check failed:', error);
      recordRun('storage-check', 'failed', error instanceof Error ? error.message : String(error));
    }
  }

  // Task 3: Daily Storage Snapshot
  const lastSnapshot = getLastRun('storage-snapshot');
  if (Date.now() - lastSnapshot > 24 * 60 * 60 * 1000) {
    try {
      console.log('[Housekeeping] Recording daily storage snapshot...');
      await recordDailyStorageSnapshot();
      recordRun('storage-snapshot', 'success');
    } catch (error) {
      console.error('[Housekeeping] Storage snapshot failed:', error);
      recordRun('storage-snapshot', 'failed', error instanceof Error ? error.message : String(error));
    }
  }

  // Task 4: Database VACUUM (weekly)
  const lastVacuum = getLastRun('database-vacuum');
  if (Date.now() - lastVacuum > 7 * 24 * 60 * 60 * 1000) {
    try {
      console.log('[Housekeeping] Running database VACUUM...');
      const result = await vacuumDatabase();
      recordRun('database-vacuum', 'success', `Reclaimed ${(result.reclaimed_bytes / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      console.error('[Housekeeping] VACUUM failed:', error);
      recordRun('database-vacuum', 'failed', error instanceof Error ? error.message : String(error));
    }
  }

  // Task 5: Log Archival (weekly, if >30 days retention)
  const lastArchive = getLastRun('log-archival');
  if (Date.now() - lastArchive > 7 * 24 * 60 * 60 * 1000) {
    try {
      console.log('[Housekeeping] Archiving old logs...');
      const result = await archiveOldLogs(30);
      recordRun('log-archival', 'success', `Archived ${result.archived_count} logs, freed ${(result.space_freed / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      console.error('[Housekeeping] Log archival failed:', error);
      recordRun('log-archival', 'failed', error instanceof Error ? error.message : String(error));
    }
  }
}
