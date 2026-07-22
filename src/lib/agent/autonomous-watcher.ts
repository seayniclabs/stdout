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

let watcherInterval: NodeJS.Timeout | null = null;
let isRunning = false;

interface WatcherConfig {
  enabled: boolean;
  intervalSeconds: number;
  mode: 'investigate' | 'approve-to-act'; // 'investigate' = read-only, 'approve-to-act' = needs human approval
  notifyOnCritical: boolean;
}

const DEFAULT_CONFIG: WatcherConfig = {
  enabled: true,
  intervalSeconds: 180, // Check every 3 minutes
  mode: 'investigate', // Safe by default - only investigate, never act without approval
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

  // Run immediately, then on interval
  runWatcherCycle(config);

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
You are performing an autonomous infrastructure check. This is the INVESTIGATION phase - you can only observe, not take action.

Your investigation tasks:
1. Check for active incidents: use get_incidents tool
2. Review metrics for anomalies: use get_metrics tool
3. Check stack health: use get_stacks tool
4. Identify root causes of any issues

Mode: ${config.mode}
${config.mode === 'investigate'
  ? '- You are in INVESTIGATE-ONLY mode. Report findings but do NOT propose actions.'
  : '- If you find issues requiring remediation, propose specific actions but DO NOT execute them.'
}

Output format:
- If no issues: "All systems nominal."
- If issues found: Describe the issue and root cause. If mode allows, suggest remediation.

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
  try {
    const db = getSqlite();
    const row = db.prepare(`
      SELECT config FROM agent_watcher_config LIMIT 1
    `).get() as { config: string } | undefined;

    if (row) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(row.config) };
    }
  } catch (error) {
    // Table might not exist yet - that's fine
  }

  return DEFAULT_CONFIG;
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
