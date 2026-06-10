/**
 * Observatory Knowledge Retrieval (RAG Layer)
 *
 * Queries the learning layer to retrieve relevant patterns, metrics, and past incidents
 * for use in agent prompts during anomaly detection and incident investigation.
 */

import { getCentralDb } from '../db';
import { sql } from 'drizzle-orm';
import type { StandardPattern, Baseline, CustomPattern } from './types';

export interface RetrievalContext {
  // What we're analyzing
  stackId?: string;
  stackName?: string;
  metricName?: string;
  metricValue?: number;
  symptoms?: string[];

  // Time window
  timeWindowHours?: number;
}

export interface RelevantKnowledge {
  // Standard library patterns that match
  standardPatterns: StandardPattern[];

  // Baselines for this stack/metric
  baselines: Baseline[];

  // Custom patterns learned from this installation
  customPatterns: CustomPattern[];

  // Similar past incidents (from incidents table)
  similarIncidents: Array<{
    id: string;
    title: string;
    description: string;
    severity: string;
    resolved_at: number | null;
    resolution_summary?: string;
  }>;

  // Retrieval metadata
  retrievalStats: {
    standardPatternsFound: number;
    customPatternsFound: number;
    baselinesFound: number;
    similarIncidentsFound: number;
    queryTimeMs: number;
  };
}

/**
 * Retrieve relevant knowledge for an anomaly or incident
 *
 * Uses multiple retrieval strategies:
 * 1. Pattern matching by symptoms/category
 * 2. Baseline comparison for metrics
 * 3. Similar past incidents (semantic similarity via FTS)
 * 4. Custom patterns learned from this installation
 */
export async function retrieveKnowledge(
  userId: string,
  context: RetrievalContext
): Promise<RelevantKnowledge> {
  const startTime = Date.now();
  const db = getCentralDb();

  // 1. Retrieve standard patterns
  const standardPatterns = await retrieveStandardPatterns(context);

  // 2. Retrieve baselines if we have metric context
  const baselines = context.metricName && context.stackId
    ? await retrieveBaselines(context.stackId, context.metricName)
    : [];

  // 3. Retrieve custom patterns
  const customPatterns = await retrieveCustomPatterns(userId, context);

  // 4. Find similar past incidents
  const similarIncidents = await retrieveSimilarIncidents(userId, context);

  const queryTimeMs = Date.now() - startTime;

  return {
    standardPatterns,
    baselines,
    customPatterns,
    similarIncidents,
    retrievalStats: {
      standardPatternsFound: standardPatterns.length,
      customPatternsFound: customPatterns.length,
      baselinesFound: baselines.length,
      similarIncidentsFound: similarIncidents.length,
      queryTimeMs
    }
  };
}

/**
 * Retrieve standard patterns from the library
 *
 * Strategy:
 * - If symptoms provided, search by symptom text (JSON array LIKE)
 * - If metric name provided, map to category (e.g., cpu_percent → resource_exhaustion)
 * - Otherwise return top patterns by confidence
 */
async function retrieveStandardPatterns(
  context: RetrievalContext
): Promise<StandardPattern[]> {
  const db = getCentralDb();

  // Build query conditions
  const conditions: string[] = [];
  const params: any[] = [];

  // Match by symptoms if provided
  if (context.symptoms && context.symptoms.length > 0) {
    // Search for any symptom in the symptoms JSON array
    const symptomConditions = context.symptoms.map(() =>
      `symptoms LIKE ?`
    ).join(' OR ');
    conditions.push(`(${symptomConditions})`);

    context.symptoms.forEach(symptom => {
      params.push(`%${symptom.toLowerCase()}%`);
    });
  }

  // Infer category from metric name
  if (context.metricName) {
    const category = inferCategoryFromMetric(context.metricName);
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
  }

  // Build WHERE clause
  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Execute query
  const query = `
    SELECT
      id,
      pattern_name,
      category,
      symptoms,
      common_causes,
      resolution_steps,
      prevention_steps,
      confidence_threshold,
      source,
      created_at,
      updated_at
    FROM observatory_standard_patterns
    ${whereClause}
    ORDER BY confidence_threshold DESC
    LIMIT 10
  `;

  const rows = await db.all(sql.raw(query, params)) as any[];

  return rows.map(row => ({
    id: row.id,
    patternName: row.pattern_name,
    category: row.category,
    symptoms: JSON.parse(row.symptoms),
    commonCauses: JSON.parse(row.common_causes),
    resolutionSteps: JSON.parse(row.resolution_steps),
    preventionSteps: row.prevention_steps ? JSON.parse(row.prevention_steps) : [],
    confidenceThreshold: row.confidence_threshold,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Retrieve baselines for a stack + metric
 *
 * Returns the rolling 7-day baseline data for comparison
 */
async function retrieveBaselines(
  stackId: string,
  metricName: string
): Promise<Baseline[]> {
  const db = getCentralDb();

  const rows = await db.all(sql`
    SELECT
      stack_id,
      metric_name,
      baseline_mean,
      baseline_stddev,
      baseline_p95,
      sample_count,
      window_start,
      window_end,
      created_at,
      updated_at
    FROM observatory_baselines
    WHERE stack_id = ${stackId}
      AND metric_name = ${metricName}
      AND window_end > ${Date.now() - 7 * 24 * 60 * 60 * 1000}
    ORDER BY window_end DESC
    LIMIT 1
  `) as any[];

  return rows.map(row => ({
    stackId: row.stack_id,
    metricName: row.metric_name,
    baselineMean: row.baseline_mean,
    baselineStddev: row.baseline_stddev,
    baselineP95: row.baseline_p95,
    sampleCount: row.sample_count,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Retrieve custom patterns learned from this installation
 *
 * These are patterns the user has created or that Observatory has learned
 * from repeated incidents
 */
async function retrieveCustomPatterns(
  userId: string,
  context: RetrievalContext
): Promise<CustomPattern[]> {
  const db = getCentralDb();

  // Build query conditions (same logic as standard patterns)
  const conditions: string[] = ['user_id = ?'];
  const params: any[] = [userId];

  if (context.symptoms && context.symptoms.length > 0) {
    const symptomConditions = context.symptoms.map(() =>
      `symptoms LIKE ?`
    ).join(' OR ');
    conditions.push(`(${symptomConditions})`);

    context.symptoms.forEach(symptom => {
      params.push(`%${symptom.toLowerCase()}%`);
    });
  }

  if (context.metricName) {
    const category = inferCategoryFromMetric(context.metricName);
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const query = `
    SELECT
      id,
      user_id,
      pattern_name,
      category,
      symptoms,
      common_causes,
      resolution_steps,
      prevention_steps,
      confidence_score,
      occurrences,
      last_seen,
      created_at,
      updated_at
    FROM observatory_custom_patterns
    ${whereClause}
    ORDER BY occurrences DESC, confidence_score DESC
    LIMIT 5
  `;

  const rows = await db.all(sql.raw(query, params)) as any[];

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    patternName: row.pattern_name,
    category: row.category,
    symptoms: JSON.parse(row.symptoms),
    commonCauses: JSON.parse(row.common_causes),
    resolutionSteps: JSON.parse(row.resolution_steps),
    preventionSteps: row.prevention_steps ? JSON.parse(row.prevention_steps) : [],
    confidenceScore: row.confidence_score,
    occurrences: row.occurrences,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Find similar past incidents using FTS search
 *
 * Searches incident title + description for symptom keywords
 * Returns only resolved incidents (we learned from these)
 */
async function retrieveSimilarIncidents(
  userId: string,
  context: RetrievalContext
): Promise<Array<{
  id: string;
  title: string;
  description: string;
  severity: string;
  resolved_at: number | null;
  resolution_summary?: string;
}>> {
  const db = getCentralDb();

  // Build FTS search query from symptoms
  if (!context.symptoms || context.symptoms.length === 0) {
    return [];
  }

  const searchTerms = context.symptoms.join(' OR ');

  const rows = await db.all(sql`
    SELECT
      i.id,
      i.title,
      i.description,
      i.severity,
      i.resolved_at,
      r.content as resolution_summary
    FROM incidents i
    JOIN incidents_fts fts ON fts.rowid = i.rowid
    LEFT JOIN resolutions r ON r.incident_id = i.id
    WHERE i.user_id = ${userId}
      AND i.resolved_at IS NOT NULL
      AND incidents_fts MATCH ${searchTerms}
    ORDER BY i.resolved_at DESC
    LIMIT 5
  `) as any[];

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    resolved_at: row.resolved_at,
    resolution_summary: row.resolution_summary
  }));
}

/**
 * Map metric name to incident category
 *
 * Helps narrow pattern search when we know what metric triggered the alert
 */
function inferCategoryFromMetric(metricName: string): string | null {
  const categoryMap: Record<string, string> = {
    'cpu_percent': 'resource_exhaustion',
    'memory_percent': 'resource_exhaustion',
    'disk_percent': 'resource_exhaustion',
    'network_errors': 'network',
    'response_time_ms': 'performance',
    'error_rate': 'service_crash',
    'connection_count': 'resource_exhaustion'
  };

  return categoryMap[metricName] || null;
}

/**
 * Format retrieved knowledge into a compact summary for agent prompts
 *
 * This is what gets injected into Watcher/Analyst system prompts
 */
export function formatKnowledgeForPrompt(knowledge: RelevantKnowledge): string {
  const sections: string[] = [];

  // Standard patterns
  if (knowledge.standardPatterns.length > 0) {
    sections.push('# STANDARD PATTERNS');
    knowledge.standardPatterns.forEach((pattern, idx) => {
      sections.push(`\n## Pattern ${idx + 1}: ${pattern.patternName}`);
      sections.push(`Category: ${pattern.category}`);
      sections.push(`Confidence: ${(pattern.confidenceThreshold * 100).toFixed(0)}%`);
      sections.push(`Symptoms: ${pattern.symptoms.join(', ')}`);
      sections.push(`Common Causes: ${pattern.commonCauses.join(', ')}`);
      sections.push(`Resolution: ${pattern.resolutionSteps.slice(0, 3).join('; ')}`);
    });
  }

  // Baselines
  if (knowledge.baselines.length > 0) {
    sections.push('\n# BASELINES');
    knowledge.baselines.forEach(baseline => {
      sections.push(`\n${baseline.metricName}:`);
      sections.push(`  Normal: ${baseline.baselineMean.toFixed(2)} ± ${baseline.baselineStddev.toFixed(2)}`);
      sections.push(`  P95: ${baseline.baselineP95.toFixed(2)}`);
      sections.push(`  (${baseline.sampleCount} samples over 7 days)`);
    });
  }

  // Custom patterns
  if (knowledge.customPatterns.length > 0) {
    sections.push('\n# YOUR LEARNED PATTERNS');
    knowledge.customPatterns.forEach((pattern, idx) => {
      sections.push(`\n## Custom ${idx + 1}: ${pattern.patternName}`);
      sections.push(`Seen ${pattern.occurrences} times, confidence ${(pattern.confidenceScore * 100).toFixed(0)}%`);
      sections.push(`Resolution: ${pattern.resolutionSteps.slice(0, 2).join('; ')}`);
    });
  }

  // Similar incidents
  if (knowledge.similarIncidents.length > 0) {
    sections.push('\n# SIMILAR PAST INCIDENTS');
    knowledge.similarIncidents.forEach((incident, idx) => {
      sections.push(`\n${idx + 1}. ${incident.title} (${incident.severity})`);
      if (incident.resolution_summary) {
        sections.push(`   Resolution: ${incident.resolution_summary.slice(0, 200)}...`);
      }
    });
  }

  return sections.join('\n');
}
