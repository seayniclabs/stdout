/**
 * Observatory Knowledge Retrieval (RAG Layer)
 *
 * Queries the learning layer to retrieve relevant patterns, metrics, and past incidents
 * for use in agent prompts during anomaly detection and incident investigation.
 */

import { getDb } from '../db';
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

  // Library docs (runbooks/postmortems/guides/notes) — internal + community. Part of the learning
  // layer alongside integrations. Public/external docs included only when the admin opts in.
  libraryDocs: Array<{
    id: string;
    title: string;
    docType: string;
    source: string; // 'user' | 'community' | 'fork'
    snippet: string;
  }>;

  // Retrieval metadata
  retrievalStats: {
    standardPatternsFound: number;
    customPatternsFound: number;
    baselinesFound: number;
    similarIncidentsFound: number;
    libraryDocsFound: number;
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
  const db = getDb();

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

  // 5. Library docs (runbooks/postmortems/guides) — internal + community, public if opted in.
  const libraryDocs = await retrieveLibraryDocs(userId, context);

  const queryTimeMs = Date.now() - startTime;

  return {
    standardPatterns,
    baselines,
    customPatterns,
    similarIncidents,
    libraryDocs,
    retrievalStats: {
      standardPatternsFound: standardPatterns.length,
      customPatternsFound: customPatterns.length,
      baselinesFound: baselines.length,
      similarIncidentsFound: similarIncidents.length,
      libraryDocsFound: libraryDocs.length,
      queryTimeMs
    }
  };
}

/**
 * Retrieve relevant library docs (runbooks/postmortems/guides/notes) from the learning layer.
 *
 * Sources, by policy (Charlie 2026-06-12):
 *   - internal docs (source='user'|'fork') → ALWAYS included.
 *   - community docs (source='community')  → ALWAYS included (they're already sanitized + gated).
 *   - public/external resources            → ONLY when the admin set tenant_preferences
 *                                            .rag_include_public = 1 (off by default).
 *
 * Matches by symptom/title keyword overlap (LIKE). Returns short snippets to keep prompt size down.
 */
async function retrieveLibraryDocs(
  userId: string,
  context: RetrievalContext,
): Promise<RelevantKnowledge['libraryDocs']> {
  const db = getDb();

  // Admin opt-in for public resources.
  let includePublic = false;
  try {
    const pref = db.get(sql`
      SELECT rag_include_public FROM system_settings WHERE id = 'instance'
    `) as { rag_include_public: number } | undefined;
    includePublic = !!pref?.rag_include_public;
  } catch { /* column may not exist on very old DBs — default off */ }

  // Build keyword set from symptoms + stack name.
  const terms = Array.from(new Set(
    [...(context.symptoms || []), context.stackName || '']
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  )).slice(0, 6);

  // Source filter: internal + community always; 'public' only when opted in. ('public' is a future
  // source value for ingested external resources; the filter is forward-compatible.)
  const allowedSources = includePublic
    ? ['user', 'fork', 'community', 'public']
    : ['user', 'fork', 'community'];
  const sourceList = allowedSources.map((s) => `'${s}'`).join(',');

  try {
    let rows: Array<{ id: string; title: string; doc_type: string; source: string; content: string }>;
    if (terms.length === 0) {
      // No symptoms — return a few most-recent runbooks/postmortems as general context.
      rows = db.all(sql`
        SELECT id, title, doc_type, source, content FROM docs
        WHERE source IN (${sql.raw(sourceList)})
          AND doc_type IN ('runbook','postmortem','guide')
        ORDER BY updated_at DESC LIMIT 3
      `) as any[];
    } else {
      const like = `%${terms[0]}%`;
      rows = db.all(sql`
        SELECT id, title, doc_type, source, content FROM docs
        WHERE source IN (${sql.raw(sourceList)})
          AND (lower(title) LIKE ${like} OR lower(tags) LIKE ${like} OR lower(content) LIKE ${like})
        ORDER BY updated_at DESC LIMIT 5
      `) as any[];
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      docType: r.doc_type,
      source: r.source,
      snippet: (r.content || '').replace(/\s+/g, ' ').slice(0, 240),
    }));
  } catch {
    return [];
  }
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
  const db = getDb();

  // Build query conditions
  const conditions: string[] = [];
  const params: unknown[] = [];

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
      confidence_threshold,
      source,
      created_at,
      updated_at
    FROM observatory_standard_patterns
    ${whereClause}
    ORDER BY confidence_threshold DESC
    LIMIT 10
  `;

  // Parameterized via the raw better-sqlite3 client (`sql.raw` can't bind params).
  let rows: unknown[] = [];
  try {
    const raw = (db as any).$client;
    rows = raw?.prepare ? raw.prepare(query).all(...params) : [];
  } catch {
    rows = [];
  }

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
  const db = getDb();

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
  const db = getDb();

  // Build query conditions (same logic as standard patterns)
  const conditions: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];

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

  // Parameterized via the underlying better-sqlite3 client (the `?` placeholders above bind to
  // `params`). `sql.raw` does not accept bind params, so use the raw prepared statement.
  let rows: unknown[] = [];
  try {
    const raw = (db as any).$client;
    rows = raw?.prepare ? raw.prepare(query).all(...params) : [];
  } catch {
    rows = [];
  }

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
  const db = getDb();

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
    WHERE i.resolved_at IS NOT NULL
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

  // Library docs (runbooks/postmortems/guides) — internal + community knowledge.
  if (knowledge.libraryDocs && knowledge.libraryDocs.length > 0) {
    sections.push('\n# LIBRARY DOCS');
    knowledge.libraryDocs.forEach((doc, idx) => {
      sections.push(`\n${idx + 1}. [${doc.docType}/${doc.source}] ${doc.title}`);
      if (doc.snippet) sections.push(`   ${doc.snippet}...`);
    });
  }

  return sections.join('\n');
}
