/**
 * Observatory Sentinel - Anomaly Detection & Agent Dispatch
 *
 * Continuously monitors metrics and triggers Observatory agents when anomalies detected.
 * This is the "watcher loop" that runs in the background.
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { buildWatcherPromptWithKnowledge, formatAgentOutput } from './prompts';
import { retrieveKnowledge } from './retrieval';
import { AGENT_PERSONAS } from './agents';
import { isOllamaAvailable, callWatcherModel } from './ollama';
import type { WatcherContext } from './prompts';

export interface MetricSnapshot {
  stackId: string;
  stackName: string;
  timestamp: number;
  metrics: Record<string, number>;
}

export interface AnomalyDetection {
  detected: boolean;
  metricName?: string;
  currentValue?: number;
  baseline?: { mean: number; stdDev: number };
  deviationSigma?: number;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  reasoning: string;
  recommendedAction: 'create_incident' | 'monitor' | 'ignore';
  suggestedTitle?: string;
}

/**
 * Check a stack for anomalies
 *
 * Compares current metrics against baselines and triggers Watcher agent
 */
export async function checkStackForAnomalies(
  userId: string,
  stackId: string,
  metrics: MetricSnapshot
): Promise<AnomalyDetection | null> {
  const db = getDb();

  // 1. Retrieve baselines for this stack
  const baselines = await retrieveBaselines(stackId);

  if (Object.keys(baselines).length === 0) {
    // No baselines yet - need 7 days of data
    console.log(`[Sentinel] No baselines for stack ${stackId} - collecting data`);
    return null;
  }

  // 2. Check recent incidents to avoid duplicate alerts
  const recentIncidents = await getRecentIncidents(userId, stackId, 24); // Last 24 hours

  // 3. Build Watcher context
  const context: WatcherContext = {
    stackId,
    stackName: metrics.stackName,
    currentMetrics: metrics.metrics,
    baselines,
    recentIncidents,
    standardPatterns: [] // Will be populated by retrieval
  };

  // 4. Call Watcher agent with retrieved knowledge
  const detection = await callWatcherAgent(userId, context);

  // 5. Record the agent run
  if (detection) {
    await recordAgentRun(userId, {
      agentName: 'watcher',
      stackId,
      trigger: 'scheduled_check',
      inputContext: JSON.stringify(context),
      outputDecision: JSON.stringify(detection),
      decisionMade: detection.recommendedAction,
      confidenceScore: detection.confidence,
      executionTimeMs: 0 // Will be measured in actual implementation
    });
  }

  return detection;
}

/**
 * Retrieve baselines for a stack
 */
async function retrieveBaselines(
  stackId: string
): Promise<Record<string, { mean: number; stdDev: number; sampleCount: number }>> {
  const db = getDb();

  // Columns are mean / std_dev (see observatory_baselines DDL in scripts/apply-schema.js).
  const rows = await db.all(sql`
    SELECT
      metric_name,
      mean,
      std_dev,
      sample_count
    FROM observatory_baselines
    WHERE stack_id = ${stackId}
      AND window_end > ${Date.now() - 7 * 24 * 60 * 60 * 1000}
    ORDER BY window_end DESC
  `) as any[];

  const baselines: Record<string, { mean: number; stdDev: number; sampleCount: number }> = {};

  for (const row of rows) {
    // Only keep the most recent baseline per metric
    if (!baselines[row.metric_name]) {
      baselines[row.metric_name] = {
        mean: row.mean,
        stdDev: row.std_dev,
        sampleCount: row.sample_count
      };
    }
  }

  return baselines;
}

/**
 * Get recent incidents for this stack
 */
async function getRecentIncidents(
  userId: string,
  stackId: string,
  hoursBack: number
): Promise<Array<{ id: string; title: string; severity: string; createdAt: Date }>> {
  const db = getDb();

  const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);

  const rows = await db.all(sql`
    SELECT id, title, severity, created_at
    FROM incidents
    WHERE stack_id = ${stackId}
      AND created_at > ${cutoff}
    ORDER BY created_at DESC
    LIMIT 10
  `) as any[];

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    severity: row.severity,
    createdAt: new Date(row.created_at)
  }));
}

/**
 * Call Watcher agent with local ML model
 *
 * Calls Ollama with Llama 3.2 3B, falls back to rule-based if unavailable
 */
async function callWatcherAgent(
  userId: string,
  context: WatcherContext
): Promise<AnomalyDetection | null> {
  const startTime = Date.now();

  try {
    // Build prompt with retrieved knowledge
    const systemPrompt = await buildWatcherPromptWithKnowledge(userId, context);

    // Check if Ollama is available
    const ollamaReady = await isOllamaAvailable();

    if (ollamaReady) {
      // Call Ollama Watcher model (Llama 3.2 3B)
      try {
        const rawOutput = await callWatcherModel(systemPrompt);
        const { parsed } = formatAgentOutput('watcher', rawOutput);

        if (parsed && parsed.anomaly_detected) {
          return {
            detected: true,
            metricName: parsed.metric_name,
            currentValue: parsed.current_value,
            baseline: parsed.baseline,
            deviationSigma: parsed.deviation_sigma,
            severity: parsed.suggested_severity || 'medium',
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            recommendedAction: parsed.recommended_action,
            suggestedTitle: parsed.suggested_title
          };
        }

        return null; // No anomalies detected by ML model
      } catch (ollamaError) {
        console.error('[Sentinel] Ollama call failed, falling back to rule-based:', ollamaError);
        // Fall through to rule-based detection
      }
    }

    // Fallback: Simple rule-based anomaly detection
    for (const [metricName, value] of Object.entries(context.currentMetrics)) {
      const baseline = context.baselines[metricName];
      if (!baseline) continue;

      const deviation = (value - baseline.mean) / baseline.stdDev;

      // Alert if deviation > 2 sigma
      if (Math.abs(deviation) > 2) {
        return {
          detected: true,
          metricName,
          currentValue: value,
          baseline: { mean: baseline.mean, stdDev: baseline.stdDev },
          deviationSigma: Math.abs(deviation),
          severity: Math.abs(deviation) > 3 ? 'high' : 'medium',
          confidence: Math.min(Math.abs(deviation) / 3, 1.0),
          reasoning: `Rule-based: ${metricName} is ${deviation.toFixed(2)}σ from baseline (${value.toFixed(2)} vs ${baseline.mean.toFixed(2)} ± ${baseline.stdDev.toFixed(2)})`,
          recommendedAction: Math.abs(deviation) > 3 ? 'create_incident' : 'monitor',
          suggestedTitle: `${metricName} anomaly detected: ${value.toFixed(2)}`
        };
      }
    }

    return null; // No anomalies detected
  } catch (error) {
    console.error('[Sentinel] Watcher agent failed:', error);
    return null;
  }
}

/**
 * Record agent run in database
 */
async function recordAgentRun(
  userId: string,
  run: {
    agentName: string;
    stackId?: string;
    trigger: string;
    inputContext: string;
    outputDecision: string;
    decisionMade: string;
    confidenceScore: number;
    executionTimeMs: number;
  }
): Promise<void> {
  const db = getDb();

  const id = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  await db.run(sql`
    INSERT INTO observatory_agent_runs (
      id,
      user_id,
      agent_name,
      stack_id,
      trigger,
      input_context,
      output_decision,
      decision_made,
      confidence_score,
      execution_time_ms,
      created_at
    ) VALUES (
      ${id},
      ${userId},
      ${run.agentName},
      ${run.stackId || null},
      ${run.trigger},
      ${run.inputContext},
      ${run.outputDecision},
      ${run.decisionMade},
      ${run.confidenceScore},
      ${run.executionTimeMs},
      ${Date.now()}
    )
  `);
}

/**
 * Auto-create incident from Watcher detection
 */
export async function createIncidentFromAnomaly(
  userId: string,
  stackId: string,
  detection: AnomalyDetection
): Promise<string> {
  const db = getDb();

  const id = `inc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = Date.now();

  const description = `Observatory Watcher detected an anomaly:

**Metric:** ${detection.metricName}
**Current Value:** ${detection.currentValue?.toFixed(2)}
**Baseline:** ${detection.baseline?.mean.toFixed(2)} ± ${detection.baseline?.stdDev.toFixed(2)}
**Deviation:** ${detection.deviationSigma?.toFixed(2)}σ
**Confidence:** ${(detection.confidence * 100).toFixed(0)}%

**Analysis:**
${detection.reasoning}

This incident was automatically created by Observatory. Review the metrics and consult similar past incidents for resolution guidance.`;

  await db.run(sql`
    INSERT INTO incidents (
      id,
      user_id,
      stack_id,
      title,
      description,
      severity,
      status,
      tags,
      created_at,
      updated_at
    ) VALUES (
      ${id},
      ${userId},
      ${stackId},
      ${detection.suggestedTitle || 'Observatory Anomaly Detected'},
      ${description},
      ${detection.severity || 'medium'},
      'active',
      'observatory,auto-detected',
      ${now},
      ${now}
    )
  `);

  // Sync to FTS
  await db.run(sql`
    INSERT INTO incidents_fts(rowid, title, description, tags)
    SELECT rowid, title, description, tags FROM incidents WHERE id = ${id}
  `);

  return id;
}

/**
 * Scheduled check loop (called by cron/interval)
 *
 * Checks all active stacks for anomalies
 */
export async function runScheduledCheck(userId: string): Promise<{
  stacksChecked: number;
  anomaliesDetected: number;
  incidentsCreated: number;
}> {
  const db = getDb();

  // Get all active stacks
  const stacks = await db.all(sql`
    SELECT id, name
    FROM stacks
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `) as any[];

  let anomaliesDetected = 0;
  let incidentsCreated = 0;

  // Live metric ingestion: pull real resource metrics from Prometheus (cAdvisor) so anomaly
  // detection runs on actual data. Host-aggregate metrics apply to every discovered stack.
  const { fetchLiveMetrics } = await import('./metrics-fetcher');
  const liveMetrics = await fetchLiveMetrics(userId);

  for (const stack of stacks) {
    const metrics: MetricSnapshot = {
      stackId: stack.id,
      stackName: stack.name,
      timestamp: Date.now(),
      metrics: liveMetrics,
    };

    if (Object.keys(metrics.metrics).length === 0) {
      continue; // No metrics available from Prometheus this tick — nothing to check.
    }

    const detection = await checkStackForAnomalies(userId, stack.id, metrics);

    if (detection?.detected && detection.recommendedAction === 'create_incident') {
      anomaliesDetected++;

      // Create incident
      await createIncidentFromAnomaly(userId, stack.id, detection);
      incidentsCreated++;

      console.log(`[Sentinel] Created incident for ${stack.name}: ${detection.suggestedTitle}`);
    }
  }

  return {
    stacksChecked: stacks.length,
    anomaliesDetected,
    incidentsCreated
  };
}

/**
 * Start Sentinel monitoring loop
 *
 * Runs checks every N seconds based on Watcher persona config
 */
export function startSentinel(userId: string): NodeJS.Timeout {
  const checkInterval = AGENT_PERSONAS.watcher.check_interval_seconds || 180; // Default 3 minutes

  console.log(`[Sentinel] Starting Observatory monitoring for user ${userId}`);
  console.log(`[Sentinel] Check interval: ${checkInterval}s`);

  const interval = setInterval(async () => {
    try {
      const result = await runScheduledCheck(userId);
      console.log(`[Sentinel] Check complete:`, result);
    } catch (error) {
      console.error('[Sentinel] Check failed:', error);
    }
  }, checkInterval * 1000);

  return interval;
}

/**
 * Stop Sentinel monitoring
 */
export function stopSentinel(interval: NodeJS.Timeout): void {
  clearInterval(interval);
  console.log('[Sentinel] Monitoring stopped');
}
