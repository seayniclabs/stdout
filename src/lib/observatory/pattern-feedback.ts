/**
 * Closed-loop pattern confidence feedback (P6, Charlie 2026-06-12).
 *
 * The learning layer retrieves patterns; this closes the loop by FEEDING OUTCOMES BACK into a
 * pattern's confidence. When a remediation derived from a pattern succeeds, nudge that pattern's
 * confidence up and bump its success/occurrence counters; when it fails, nudge down. Over time the
 * patterns that actually resolve incidents rise to the top of retrieval, and the ones that don't
 * decay — the system gets measurably better at what it's seen, not just bigger.
 *
 * Confidence is bounded to [MIN, MAX] so a single streak can't pin it at 0 or 1. Custom patterns
 * (per-installation, `observatory_custom_patterns.confidence_score`) and auto-documented standard
 * patterns (`observatory_standard_patterns.confidence_threshold`, source IN ('auto')) are both
 * adjustable; curated stdlib patterns (source='stdlib') are left alone — we don't second-guess the
 * shipped library from one user's outcome.
 *
 * Every adjustment is also logged to `observatory_feedback` for auditability.
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const MIN_CONF = 0.1;
const MAX_CONF = 0.95;
const UP = 0.05;   // success nudge
const DOWN = 0.08; // failure nudge (slightly larger — fail fast, trust slowly)

function clamp(v: number): number {
  return Math.max(MIN_CONF, Math.min(MAX_CONF, v));
}

export interface FeedbackResult {
  patternId: string | null;
  kind: 'custom' | 'standard' | 'none';
  oldConfidence?: number;
  newConfidence?: number;
  adjusted: boolean;
  reason: string;
}

/**
 * Record an outcome for a pattern and adjust its confidence.
 *
 * @param patternId  the custom or auto standard pattern that informed the remediation
 * @param success    did the remediation resolve/help?
 * @param incidentId for the feedback audit row
 * @param agentType  who acted (e.g. 'analyst', 'autopilot')
 * @param notes      optional human-readable note
 */
export function recordPatternOutcome(opts: {
  patternId: string;
  success: boolean;
  incidentId: string;
  agentType?: string;
  notes?: string;
}): FeedbackResult {
  const db = getDb();
  const now = Date.now();
  const delta = opts.success ? UP : -DOWN;

  // Try custom pattern first.
  const custom = db.get(sql`
    SELECT id, confidence_score FROM observatory_custom_patterns WHERE id = ${opts.patternId}
  `) as { id: string; confidence_score: number } | undefined;

  let result: FeedbackResult;

  if (custom) {
    const oldC = custom.confidence_score ?? 0.5;
    const newC = clamp(oldC + delta);
    db.run(sql`
      UPDATE observatory_custom_patterns
      SET confidence_score = ${newC},
          occurrences = occurrences + 1,
          successes = successes + ${opts.success ? 1 : 0},
          last_seen = ${now},
          updated_at = ${now}
      WHERE id = ${opts.patternId}
    `);
    result = { patternId: custom.id, kind: 'custom', oldConfidence: oldC, newConfidence: newC, adjusted: true,
      reason: `custom pattern confidence ${oldC.toFixed(2)} → ${newC.toFixed(2)} (${opts.success ? 'success' : 'failure'})` };
  } else {
    // Auto-documented standard pattern (never curated stdlib).
    const std = db.get(sql`
      SELECT id, confidence_threshold, source FROM observatory_standard_patterns WHERE id = ${opts.patternId}
    `) as { id: string; confidence_threshold: number; source: string } | undefined;

    if (std && std.source === 'auto') {
      const oldC = std.confidence_threshold ?? 0.6;
      const newC = clamp(oldC + delta);
      db.run(sql`
        UPDATE observatory_standard_patterns
        SET confidence_threshold = ${newC}, updated_at = ${now}
        WHERE id = ${opts.patternId}
      `);
      result = { patternId: std.id, kind: 'standard', oldConfidence: oldC, newConfidence: newC, adjusted: true,
        reason: `auto pattern confidence ${oldC.toFixed(2)} → ${newC.toFixed(2)} (${opts.success ? 'success' : 'failure'})` };
    } else if (std) {
      result = { patternId: std.id, kind: 'standard', adjusted: false,
        reason: `curated stdlib pattern — confidence left unchanged` };
    } else {
      result = { patternId: null, kind: 'none', adjusted: false, reason: 'pattern not found' };
    }
  }

  // Audit the feedback regardless of whether confidence moved.
  try {
    db.run(sql`
      INSERT INTO observatory_feedback
        (id, incident_id, agent_type, suggestion, user_action, actual_resolution, notes, created_at)
      VALUES (
        ${`fb_${nanoid(12)}`}, ${opts.incidentId}, ${opts.agentType ?? 'system'},
        ${`pattern:${opts.patternId}`}, ${opts.success ? 'success' : 'failure'},
        ${null}, ${(opts.notes ?? result.reason).slice(0, 500)}, ${now}
      )
    `);
  } catch { /* audit best-effort */ }

  return result;
}
