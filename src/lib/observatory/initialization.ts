/**
 * Observatory Initialization Sequence
 *
 * Runs every time StdOut starts. Fills in real DB queries for all phases
 * so the startup log reflects what's actually in the database.
 */

import { AGENT_PERSONAS } from './agents';
import { METRIC_INTERPRETATIONS } from './metrics-guide';
import { setupObservatory } from './setup';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { emit } from '../events';

export interface ObservatoryInitResult {
  success: boolean;
  agentsActivated: string[];
  knowledgeBasesConnected: string[];
  monitorsConfigured: number;
  baselinesEstablished: number;
  errors: string[];
  startupLog: string[];
  setupComplete?: boolean;
  setupWarnings?: string[];
}

export async function initializeObservatory(): Promise<ObservatoryInitResult> {
  const log: string[] = [];
  const errors: string[] = [];
  const agentsActivated: string[] = [];
  const knowledgeBasesConnected: string[] = [];
  let monitorsConfigured = 0;
  let baselinesEstablished = 0;

  log.push('Observatory Initialization Started');
  log.push(`Time: ${new Date().toISOString()}`);
  log.push('');

  // ── Phase 0: Automated Setup ──────────────────────────────────────────────
  log.push('=== PHASE 0: AUTOMATED SETUP ===');
  const setupResult = await setupObservatory();
  log.push(...setupResult.setupLog);
  log.push('');
  if (!setupResult.success) errors.push(...setupResult.errors);

  // ── Phase 1: Identity ─────────────────────────────────────────────────────
  log.push('=== PHASE 1: IDENTITY ===');
  try {
    const watcher = AGENT_PERSONAS.watcher;
    const analyst = AGENT_PERSONAS.analyst;
    log.push(`Loaded ${watcher.name} persona — ${watcher.model}, ${watcher.check_interval_seconds}s interval`);
    log.push(`Loaded ${analyst.name} persona — ${analyst.model}, standby`);
    agentsActivated.push('watcher', 'analyst');
    log.push('');
  } catch (err: any) {
    errors.push(`Failed to load agent personas: ${err.message}`);
    log.push(`Error loading personas: ${err.message}`);
  }

  // ── Phase 2: Knowledge Base ───────────────────────────────────────────────
  log.push('=== PHASE 2: KNOWLEDGE BASE ===');
  try {
    const centralDb = getDb();

    // Count standard patterns (if table exists)
    let standardPatternsCount = 0;
    try {
      const row = centralDb.get(sql`SELECT COUNT(*) as n FROM observatory_standard_patterns`) as { n: number } | undefined;
      standardPatternsCount = row?.n ?? 0;
    } catch {
      // Table may not exist yet — that's fine
    }
    log.push(`Standard Patterns: ${standardPatternsCount} loaded`);
    knowledgeBasesConnected.push('standard_patterns');

    const metricGuidesCount = Object.keys(METRIC_INTERPRETATIONS).length;
    log.push(`Metric Interpretations: ${metricGuidesCount} metrics defined`);
    knowledgeBasesConnected.push('metric_guide');

    // Get first user to check incident history (self-host = single user)
    const firstUser = centralDb.get(sql`SELECT id FROM users LIMIT 1`) as { id: string } | undefined;
    if (firstUser) {
      const tenantDb = getDb();
      const incRow = tenantDb.get(sql`SELECT COUNT(*) as n FROM incidents WHERE status = 'resolved'`) as { n: number } | undefined;
      const userIncidentsCount = incRow?.n ?? 0;

      if (userIncidentsCount > 0) {
        log.push(`User Incident History: ${userIncidentsCount} resolved incidents available for learning`);
        knowledgeBasesConnected.push('user_incidents');
      } else {
        log.push('No user incident history yet — will learn from first incidents');
      }

      // Check for baselines
      let baselinesCount = 0;
      try {
        const bRow = centralDb.get(sql`SELECT COUNT(*) as n FROM observatory_baselines`) as { n: number } | undefined;
        baselinesCount = bRow?.n ?? 0;
      } catch {
        // Table may not exist yet
      }

      if (baselinesCount > 0) {
        log.push(`Statistical Baselines: ${baselinesCount} established`);
        baselinesEstablished = baselinesCount;
      } else {
        log.push('No baselines yet — will establish over next 7 days');
      }
    }
    log.push('');
  } catch (err: any) {
    errors.push(`Failed to connect knowledge bases: ${err.message}`);
    log.push(`Error connecting knowledge bases: ${err.message}`);
  }

  // ── Phase 3: Infrastructure Discovery ────────────────────────────────────
  log.push('=== PHASE 3: INFRASTRUCTURE DISCOVERY ===');
  try {
    const centralDb = getDb();
    const firstUser = centralDb.get(sql`SELECT id FROM users LIMIT 1`) as { id: string } | undefined;

    if (firstUser) {
      const tenantDb = getDb();

      // Check if any hosts have been discovered yet
      const totalHostsRow = tenantDb.get(sql`
        SELECT COUNT(*) as n FROM discovered_hosts WHERE user_id = ${firstUser.id}
      `) as { n: number } | undefined;
      const totalHosts = totalHostsRow?.n ?? 0;

      // Auto-trigger initial network scan if no hosts discovered yet
      if (totalHosts === 0) {
        log.push('No hosts discovered yet — triggering initial network scan...');
        // Trigger scan asynchronously (don't block startup)
        triggerInitialNetworkScan(firstUser.id).catch((err) => {
          console.error('[Observatory Init] Failed to trigger initial scan:', err);
        });
        log.push('  ⏳ Initial network scan started in background');
      }

      const stacks = tenantDb.all(sql`
        SELECT id, name FROM stacks WHERE user_id = ${firstUser.id} ORDER BY created_at DESC
      `) as Array<{ id: string; name: string }>;

      if (stacks.length === 0) {
        log.push('No stacks discovered yet — waiting for scanner');
      } else {
        log.push(`Stacks discovered: ${stacks.length}`);

        for (const stack of stacks) {
          const hostRow = tenantDb.get(sql`
            SELECT COUNT(*) as n FROM discovered_hosts WHERE user_id = ${firstUser.id} AND stack_id = ${stack.id}
          `) as { n: number } | undefined;
          const hostsCount = hostRow?.n ?? 0;
          log.push(`  - ${stack.name}: ${hostsCount} hosts`);
          monitorsConfigured += 1;

          // Emit stack.created for any stack not yet in the watch queue
          const queueKey = `observatory_watch:${stack.id}`;
          const queued = centralDb.get(sql`SELECT key FROM system_state WHERE key = ${queueKey}`) as any;
          if (!queued) {
            emit({ type: 'stack.created', userId: firstUser.id, stackId: stack.id, name: stack.name, source: 'auto' });
          }
        }
      }
    } else {
      log.push('No users registered yet');
    }
    log.push('');
  } catch (err: any) {
    errors.push(`Failed to discover infrastructure: ${err.message}`);
    log.push(`Error discovering infrastructure: ${err.message}`);
  }

  // ── Phase 4: Monitors ─────────────────────────────────────────────────────
  log.push('=== PHASE 4: MONITORS ===');
  try {
    const centralDb = getDb();
    const firstUser = centralDb.get(sql`SELECT id FROM users LIMIT 1`) as { id: string } | undefined;

    if (firstUser) {
      const tenantDb = getDb();
      const existingMonitors = tenantDb.all(sql`
        SELECT id, name, type, current_status FROM monitors WHERE user_id = ${firstUser.id} ORDER BY created_at DESC
      `) as Array<{ id: string; name: string; type: string; current_status: string }>;

      if (existingMonitors.length === 0) {
        log.push('No monitors configured yet — auto-wiring will create them as hosts are discovered');
      } else {
        log.push(`Monitors active: ${existingMonitors.length}`);
        for (const mon of existingMonitors.slice(0, 10)) {
          log.push(`  - ${mon.name} (${mon.type}) — ${mon.current_status}`);
        }
        if (existingMonitors.length > 10) {
          log.push(`  ... and ${existingMonitors.length - 10} more`);
        }
      }
    }
    log.push('');
  } catch (err: any) {
    errors.push(`Failed to check monitors: ${err.message}`);
    log.push(`Error checking monitors: ${err.message}`);
  }

  // ── Phase 4.5: Data Sources + Provisional Baseline (P3 auto-config) ────────
  // Auto-configure the Observatory data sources (Prometheus/Loki/Trivy reachable at known
  // loopback ports) and seed provisional baselines so the brain starts detecting on day one
  // instead of waiting 7 days. Both are idempotent and non-fatal.
  log.push('=== PHASE 4.5: DATA SOURCES & BASELINE ===');
  try {
    const centralDb = getDb();
    const firstUser = centralDb.get(sql`SELECT id FROM users LIMIT 1`) as { id: string } | undefined;

    if (firstUser) {
      const { autoConfigureDataSources } = await import('./data-source-config');
      const dsResult = await autoConfigureDataSources(firstUser.id);
      log.push(...dsResult.log);

      const { establishProvisionalBaselines } = await import('./baseline-bootstrap');
      const blResult = await establishProvisionalBaselines(firstUser.id);
      log.push(...blResult.log);

      // Seed a default recurring-scan schedule so discovery keeps running (P2b).
      const { ensureDefaultSchedule } = await import('./scan-scheduler');
      const seeded = await ensureDefaultSchedule(firstUser.id);
      log.push(seeded
        ? '  ✓ Default scan schedule created (daily 03:00 UTC) — recurring discovery enabled'
        : '  ✓ Scan schedule already configured');

      // Reflect the just-seeded baselines in the count the activation phase reads.
      try {
        const bRow = centralDb.get(sql`SELECT COUNT(*) as n FROM observatory_baselines`) as { n: number } | undefined;
        baselinesEstablished = bRow?.n ?? baselinesEstablished;
      } catch { /* table may not exist on very old DBs */ }
    } else {
      log.push('No users yet — data sources + baselines will configure on first user');
    }
    log.push('');
  } catch (err: any) {
    // Non-fatal: discovery/detection still works without auto-config; log and continue.
    log.push(`Data-source/baseline auto-config issue (non-fatal): ${err.message}`);
    log.push('');
  }

  // ── Phase 5: Activation ───────────────────────────────────────────────────
  log.push('=== PHASE 5: AGENT ACTIVATION ===');
  try {
    const watcher = AGENT_PERSONAS.watcher;
    const analyst = AGENT_PERSONAS.analyst;

    if (watcher.active_by_default) {
      log.push(`${watcher.name} Agent: ACTIVE — ${watcher.check_interval_seconds}s interval, ${baselinesEstablished > 0 ? 'full alerting' : 'learning mode'}`);
    } else {
      log.push(`${watcher.name} Agent: inactive`);
    }
    log.push(`${analyst.name} Agent: STANDBY — activates on ${analyst.trigger_severities?.join(', ')} severity`);

    // Emit observatory.started for each registered user
    const centralDb = getDb();
    const firstUser = centralDb.get(sql`SELECT id FROM users LIMIT 1`) as { id: string } | undefined;
    if (firstUser) {
      emit({
        type: 'observatory.started',
        userId: firstUser.id,
        mode: baselinesEstablished > 0 ? 'full' : 'learning',
      });
    }

    log.push('');
  } catch (err: any) {
    errors.push(`Failed to activate agents: ${err.message}`);
    log.push(`Error activating agents: ${err.message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log.push('=== INITIALIZATION COMPLETE ===');
  const success = errors.length === 0;

  if (success) {
    log.push('Observatory is OPERATIONAL');
    log.push(`  Agents: ${agentsActivated.length} active`);
    log.push(`  Knowledge Bases: ${knowledgeBasesConnected.length} connected`);
    log.push(`  Monitors: ${monitorsConfigured} configured`);
    log.push(`  Baselines: ${baselinesEstablished > 0 ? `${baselinesEstablished} established` : 'establishing (7 days)'}`);
  } else {
    log.push('Observatory started with errors:');
    errors.forEach(err => log.push(`  - ${err}`));
  }

  log.push(`Completed at ${new Date().toISOString()}`);

  return {
    success,
    agentsActivated,
    knowledgeBasesConnected,
    monitorsConfigured,
    baselinesEstablished,
    errors,
    startupLog: log,
    setupComplete: setupResult.success,
    setupWarnings: setupResult.warnings,
  };
}

export function formatStartupBrief(result: ObservatoryInitResult): string {
  return result.startupLog.join('\n');
}

export function isObservatoryReady(result: ObservatoryInitResult): {
  ready: boolean;
  missingComponents: string[];
  recommendations: string[];
} {
  const missingComponents: string[] = [];
  const recommendations: string[] = [];

  if (!result.knowledgeBasesConnected.includes('standard_patterns')) {
    missingComponents.push('Standard patterns not loaded');
    recommendations.push('Run database migration to seed standard patterns');
  }

  if (result.monitorsConfigured === 0) {
    recommendations.push('No stacks yet — run a network scan to discover infrastructure');
  }

  if (result.baselinesEstablished === 0) {
    recommendations.push('Baselines will establish over next 7 days — operating in learning mode');
  }

  if (!result.agentsActivated.includes('watcher')) {
    missingComponents.push('Watcher agent not activated');
    recommendations.push('Enable Watcher agent in Observatory settings');
  }

  return {
    ready: missingComponents.length === 0 && result.success,
    missingComponents,
    recommendations,
  };
}

/**
 * Trigger initial network scan asynchronously on first startup
 */
async function triggerInitialNetworkScan(userId: string): Promise<void> {
  try {
    console.log('[Observatory Init] Triggering initial network scan...');

    // Mark in system_state that initial scan was triggered
    const centralDb = getDb();
    await centralDb.run(sql`
      INSERT INTO system_state (key, value, updated_at)
      VALUES ('observatory_initial_scan_triggered', ${Date.now().toString()}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    // Actually RUN the discovery — the autonomic vision requires scanners to start collecting
    // on their own, not wait for a human to click. runInitialDiscovery persists hosts and emits
    // host.discovered (→ auto-wire creates monitors). Fire-and-forget so startup isn't blocked.
    const { runInitialDiscovery } = await import('./initial-discovery');
    runInitialDiscovery(userId).catch((err) => {
      console.error('[Observatory Init] initial discovery failed:', err);
    });

  } catch (error) {
    console.error('[Observatory Init] Failed to trigger initial scan:', error);
  }
}
