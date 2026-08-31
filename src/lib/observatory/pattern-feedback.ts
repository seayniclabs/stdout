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
  const rawDb = (db as any).$client;
  const now = Date.now();
  const delta = opts.success ? UP : -DOWN;

  // Try custom pattern first.
  const custom = rawDb.prepare(`
    SELECT id, confidence_score FROM observatory_custom_patterns WHERE id = ?
  `).get(opts.patternId) as { id: string; confidence_score: number } | undefined;

  let result: FeedbackResult;

  if (custom) {
    const oldC = custom.confidence_score ?? 0.5;
    const newC = clamp(oldC + delta);
    rawDb.prepare(`
      UPDATE observatory_custom_patterns
      SET confidence_score = ?,
          occurrences = occurrences + 1,
          successes = successes + ?,
          last_seen = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newC, opts.success ? 1 : 0, now, now, opts.patternId);
    result = { patternId: custom.id, kind: 'custom', oldConfidence: oldC, newConfidence: newC, adjusted: true,
      reason: `custom pattern confidence ${oldC.toFixed(2)} → ${newC.toFixed(2)} (${opts.success ? 'success' : 'failure'})` };
  } else {
    // Auto-documented standard pattern (never curated stdlib).
    const std = rawDb.prepare(`
      SELECT id, confidence_threshold, source FROM observatory_standard_patterns WHERE id = ?
    `).get(opts.patternId) as { id: string; confidence_threshold: number; source: string } | undefined;

    if (std && std.source === 'auto') {
      const oldC = std.confidence_threshold ?? 0.6;
      const newC = clamp(oldC + delta);
      rawDb.prepare(`
        UPDATE observatory_standard_patterns
        SET confidence_threshold = ?, updated_at = ?
        WHERE id = ?
      `).run(newC, now, opts.patternId);
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
    const rawDb = (db as any).$client;
    rawDb.prepare(`
      INSERT INTO observatory_feedback
        (id, incident_id, agent_type, suggestion, user_action, actual_resolution, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `fb_${nanoid(12)}`, opts.incidentId, opts.agentType ?? 'system',
      `pattern:${opts.patternId}`, opts.success ? 'success' : 'failure',
      null, (opts.notes ?? result.reason).slice(0, 500), now
    );
  } catch { /* audit best-effort */ }

  return result;
}

/**
 * Record a human's verification of a Riggins suggestion (accept/reject/modify).
 *
 * This is the human half of the loop `recordPatternOutcome` closes for automated
 * autopilot outcomes: a person looked at a proposed diagnosis/fix and approved,
 * denied, or changed it before acting. Feeds the same `observatory_feedback`
 * table so accuracy can be computed across both automated and human-verified
 * suggestions without a second audit path.
 */
export function recordHumanVerification(opts: {
  incidentId: string;
  agentType: string;
  suggestion: string;
  action: 'accepted' | 'rejected' | 'modified';
  decidedBy?: string;
  actualResolution?: string;
  notes?: string;
}): void {
  const USER_ACTION: Record<typeof opts.action, string> = {
    accepted: 'helpful',
    rejected: 'unhelpful',
    modified: 'modified',
  };

  try {
    const db = getDb();
    const rawDb = (db as any).$client;
    rawDb.prepare(`
      INSERT INTO observatory_feedback
        (id, incident_id, agent_type, suggestion, user_action, actual_resolution, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `fb_${nanoid(12)}`, opts.incidentId, opts.agentType,
      opts.suggestion.slice(0, 500), USER_ACTION[opts.action],
      opts.actualResolution ?? null,
      (opts.notes ? `${opts.notes} ` : '') + (opts.decidedBy ? `(decided_by:${opts.decidedBy})` : ''),
      Date.now()
    );
  } catch { /* audit best-effort */ }
}

export interface AccuracyReport {
  windowDays: number;
  since: number;
  total: number;
  accepted: number;
  rejected: number;
  modified: number;
  accuracyPct: number | null; // accepted / (accepted + rejected), null if no verified suggestions
  byAgentType: Record<string, { total: number; accepted: number; rejected: number; modified: number; accuracyPct: number | null }>;
}

/**
 * Compute Riggins suggestion accuracy from `observatory_feedback` over a rolling window.
 *
 * Accuracy = accepted / (accepted + rejected). 'modified' suggestions are tracked
 * but excluded from the ratio — the human judged the diagnosis worth acting on but
 * not verbatim, which is neither a clean hit nor a miss.
 */
export function getObservatoryAccuracy(windowDays = 30): AccuracyReport {
  const db = getDb();
  const rawDb = (db as any).$client;
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const rows = rawDb.prepare(`
    SELECT agent_type, user_action
    FROM observatory_feedback
    WHERE created_at >= ?
      AND user_action IN ('helpful', 'unhelpful', 'modified', 'success', 'failure')
  `).all(since) as Array<{ agent_type: string; user_action: string }>;

  const ACCEPTED = new Set(['helpful', 'success']);
  const REJECTED = new Set(['unhelpful', 'failure']);

  const byAgentType: AccuracyReport['byAgentType'] = {};
  let accepted = 0, rejected = 0, modified = 0;

  for (const row of rows) {
    const bucket = byAgentType[row.agent_type] ??= { total: 0, accepted: 0, rejected: 0, modified: 0, accuracyPct: null };
    bucket.total++;
    if (ACCEPTED.has(row.user_action)) { accepted++; bucket.accepted++; }
    else if (REJECTED.has(row.user_action)) { rejected++; bucket.rejected++; }
    else if (row.user_action === 'modified') { modified++; bucket.modified++; }
  }

  for (const bucket of Object.values(byAgentType)) {
    const verified = bucket.accepted + bucket.rejected;
    bucket.accuracyPct = verified > 0 ? (bucket.accepted / verified) * 100 : null;
  }

  const verifiedTotal = accepted + rejected;
  return {
    windowDays,
    since,
    total: rows.length,
    accepted,
    rejected,
    modified,
    accuracyPct: verifiedTotal > 0 ? (accepted / verifiedTotal) * 100 : null,
    byAgentType,
  };
}
