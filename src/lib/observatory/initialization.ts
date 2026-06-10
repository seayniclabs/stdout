/**
 * Observatory Initialization Sequence
 *
 * When Observatory comes online, it needs to know:
 * 1. Who it is (identity/mission)
 * 2. Where its brain is (knowledge base locations)
 * 3. What to monitor (discovered infrastructure)
 * 4. How to learn (feedback loops, baselines)
 *
 * This is the "startup brief" that gets Observatory operational.
 */

import { AGENT_PERSONAS } from './agents';
import { METRIC_INTERPRETATIONS } from './metrics-guide';
import { setupObservatory } from './setup';

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

/**
 * Observatory Initialization Sequence
 *
 * Run this when:
 * - User completes setup wizard
 * - Observatory is first enabled
 * - After a system restart
 * - When knowledge base is reset
 */
export async function initializeObservatory(): Promise<ObservatoryInitResult> {
  const log: string[] = [];
  const errors: string[] = [];
  const agentsActivated: string[] = [];
  const knowledgeBasesConnected: string[] = [];
  let monitorsConfigured = 0;
  let baselinesEstablished = 0;

  log.push('🚀 Observatory Initialization Started');
  log.push(`Time: ${new Date().toISOString()}`);
  log.push('');

  // ══════════════════════════════════════════════════════════════
  // PHASE 0: AUTOMATED SETUP - Install required components
  // ══════════════════════════════════════════════════════════════
  log.push('═══ PHASE 0: AUTOMATED SETUP ═══');

  const setupResult = await setupObservatory();
  log.push(...setupResult.setupLog);
  log.push('');

  const setupWarnings = setupResult.warnings;

  if (!setupResult.success) {
    errors.push(...setupResult.errors);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 1: IDENTITY - Who am I?
  // ══════════════════════════════════════════════════════════════
  log.push('═══ PHASE 1: IDENTITY ═══');

  try {
    // Load agent personas
    const watcherPersona = AGENT_PERSONAS.watcher;
    const analystPersona = AGENT_PERSONAS.analyst;

    log.push(`✓ Loaded ${watcherPersona.name} persona`);
    log.push(`  Role: ${watcherPersona.role}`);
    log.push(`  Mission: ${watcherPersona.mission}`);
    log.push(`  Model: ${watcherPersona.model}`);
    log.push(`  Check Interval: ${watcherPersona.check_interval_seconds}s`);
    log.push('');

    log.push(`✓ Loaded ${analystPersona.name} persona`);
    log.push(`  Role: ${analystPersona.role}`);
    log.push(`  Mission: ${analystPersona.mission}`);
    log.push(`  Model: ${analystPersona.model}`);
    log.push(`  Trigger: ${analystPersona.trigger_severities?.join(', ')} severity incidents`);
    log.push('');

    agentsActivated.push('watcher', 'analyst');
  } catch (error) {
    errors.push(`Failed to load agent personas: ${error.message}`);
    log.push(`✗ Error loading personas: ${error.message}`);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 2: KNOWLEDGE BASE - Where is my brain?
  // ══════════════════════════════════════════════════════════════
  log.push('═══ PHASE 2: KNOWLEDGE BASE ═══');

  try {
    // Check standard patterns table
    // const standardPatternsCount = await db.select({ count: sql<number>`count(*)` })
    //   .from(observatoryStandardPatterns)
    //   .then(rows => rows[0].count);

    // Placeholder - will implement with actual DB queries
    const standardPatternsCount = 0; // TODO: Query actual count

    log.push(`✓ Standard Patterns: ${standardPatternsCount} loaded`);
    knowledgeBasesConnected.push('standard_patterns');

    // Check metric interpretation guide
    const metricGuidesCount = Object.keys(METRIC_INTERPRETATIONS).length;
    log.push(`✓ Metric Interpretations: ${metricGuidesCount} metrics defined`);
    knowledgeBasesConnected.push('metric_guide');

    // Check for user incidents (learning corpus)
    // const userIncidentsCount = await db.select({ count: sql<number>`count(*)` })
    //   .from(incidents)
    //   .where(eq(incidents.status, 'resolved'))
    //   .then(rows => rows[0].count);

    const userIncidentsCount = 0; // TODO: Query actual count

    if (userIncidentsCount > 0) {
      log.push(`✓ User Incident History: ${userIncidentsCount} resolved incidents available for learning`);
      knowledgeBasesConnected.push('user_incidents');
    } else {
      log.push(`ℹ No user incident history yet - will learn from first incidents`);
    }

    // Check for baselines
    // const baselinesCount = await db.select({ count: sql<number>`count(*)` })
    //   .from(observatoryBaselines)
    //   .then(rows => rows[0].count);

    const baselinesCount = 0; // TODO: Query actual count

    if (baselinesCount > 0) {
      log.push(`✓ Statistical Baselines: ${baselinesCount} established`);
      baselinesEstablished = baselinesCount;
    } else {
      log.push(`ℹ No baselines yet - will establish over next 7 days`);
      log.push(`  During this period: Collecting data, minimal alerting`);
    }

    log.push('');
  } catch (error) {
    errors.push(`Failed to connect knowledge bases: ${error.message}`);
    log.push(`✗ Error connecting knowledge bases: ${error.message}`);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 3: INFRASTRUCTURE - What am I monitoring?
  // ══════════════════════════════════════════════════════════════
  log.push('═══ PHASE 3: INFRASTRUCTURE DISCOVERY ═══');

  try {
    // Discover stacks
    // const stacks = await db.select().from(tenantSchema.stacks);

    const stacks = []; // TODO: Query actual stacks

    if (stacks.length === 0) {
      log.push(`⚠ No stacks discovered yet`);
      log.push(`  Waiting for scanner to run...`);
    } else {
      log.push(`✓ Stacks discovered: ${stacks.length}`);

      for (const stack of stacks) {
        // Count hosts per stack
        // const hostsCount = await db.select({ count: sql<number>`count(*)` })
        //   .from(discoveredHosts)
        //   .where(eq(discoveredHosts.stackId, stack.id))
        //   .then(rows => rows[0].count);

        const hostsCount = 0; // TODO: Query actual count

        log.push(`  - ${stack.name}: ${hostsCount} hosts`);

        // Create default monitors for each stack
        monitorsConfigured += 1;
      }
    }

    log.push('');
  } catch (error) {
    errors.push(`Failed to discover infrastructure: ${error.message}`);
    log.push(`✗ Error discovering infrastructure: ${error.message}`);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 4: MONITORS - Set up data collection
  // ══════════════════════════════════════════════════════════════
  log.push('═══ PHASE 4: MONITORS ═══');

  try {
    // Check existing monitors
    // const existingMonitors = await db.select().from(monitors);

    const existingMonitors = []; // TODO: Query actual monitors

    if (existingMonitors.length === 0) {
      log.push(`ℹ No monitors configured yet`);
      log.push(`  Recommendation: Configure at least one monitor to begin data collection`);
    } else {
      log.push(`✓ Monitors active: ${existingMonitors.length}`);

      for (const monitor of existingMonitors) {
        log.push(`  - ${monitor.name} (${monitor.type})`);
      }
    }

    log.push('');
  } catch (error) {
    errors.push(`Failed to check monitors: ${error.message}`);
    log.push(`✗ Error checking monitors: ${error.message}`);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 5: ACTIVATION - Start the agents
  // ══════════════════════════════════════════════════════════════
  log.push('═══ PHASE 5: AGENT ACTIVATION ═══');

  try {
    const watcherPersona = AGENT_PERSONAS.watcher;

    if (watcherPersona.active_by_default) {
      log.push(`✓ ${watcherPersona.name} Agent: ACTIVE`);
      log.push(`  Next check: ${watcherPersona.check_interval_seconds}s from now`);
      log.push(`  Mode: ${baselinesEstablished > 0 ? 'Full alerting' : 'Learning mode (minimal alerts)'}`);
    } else {
      log.push(`ℹ ${watcherPersona.name} Agent: Inactive (not enabled by default)`);
    }

    const analystPersona = AGENT_PERSONAS.analyst;
    log.push(`✓ ${analystPersona.name} Agent: STANDBY`);
    log.push(`  Will activate on: ${analystPersona.trigger_severities?.join(', ')} severity incidents`);

    log.push('');
  } catch (error) {
    errors.push(`Failed to activate agents: ${error.message}`);
    log.push(`✗ Error activating agents: ${error.message}`);
  }

  // ══════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════
  log.push('═══ INITIALIZATION COMPLETE ═══');

  const success = errors.length === 0;

  if (success) {
    log.push('✅ Observatory is OPERATIONAL');
    log.push('');
    log.push('Status:');
    log.push(`  Agents: ${agentsActivated.length} active`);
    log.push(`  Knowledge Bases: ${knowledgeBasesConnected.length} connected`);
    log.push(`  Monitors: ${monitorsConfigured} configured`);
    log.push(`  Baselines: ${baselinesEstablished > 0 ? `${baselinesEstablished} established` : 'Establishing (7 days)'}`);
    log.push('');

    if (baselinesEstablished === 0) {
      log.push('📊 Learning Phase:');
      log.push('  For the next 7 days, Observatory will:');
      log.push('  - Collect metric data to establish baselines');
      log.push('  - Operate in minimal-alert mode');
      log.push('  - Learn normal patterns for your infrastructure');
      log.push('  After 7 days, full anomaly detection will activate.');
      log.push('');
    }

    log.push('🎯 Next Steps:');
    log.push('  1. Ensure scanners are running to discover infrastructure');
    log.push('  2. Configure monitors for critical services');
    log.push('  3. Review first incidents to train the learning system');
    log.push('  4. Provide feedback on agent suggestions');
  } else {
    log.push('⚠️ Observatory started with errors:');
    errors.forEach((err) => log.push(`  - ${err}`));
    log.push('');
    log.push('Some features may not work correctly. Check logs for details.');
  }

  log.push('');
  log.push(`Initialization completed at ${new Date().toISOString()}`);

  return {
    success,
    agentsActivated,
    knowledgeBasesConnected,
    monitorsConfigured,
    baselinesEstablished,
    errors,
    startupLog: log,
    setupComplete: setupResult.success,
    setupWarnings
  };
}

/**
 * Generate startup brief for display in UI
 */
export function formatStartupBrief(result: ObservatoryInitResult): string {
  return result.startupLog.join('\n');
}

/**
 * Check if Observatory is ready for full operation
 */
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
    missingComponents.push('No monitors configured');
    recommendations.push('Configure at least one monitor in HUD');
  }

  if (result.baselinesEstablished === 0) {
    recommendations.push('Baselines will be established over next 7 days - operating in learning mode');
  }

  if (!result.agentsActivated.includes('watcher')) {
    missingComponents.push('Watcher agent not activated');
    recommendations.push('Enable Watcher agent in Observatory settings');
  }

  const ready = missingComponents.length === 0 && result.success;

  return {
    ready,
    missingComponents,
    recommendations
  };
}
