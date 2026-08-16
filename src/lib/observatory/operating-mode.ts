/**
 * Observatory Operating Modes + Auto-pilot (Charlie 2026-06-12).
 *
 * The autonomic safety envelope. Every autonomous path (sentinel/watcher/autofix apply)
 * consults this module BEFORE acting. It is the single source of truth for "what is the
 * brain allowed to do right now".
 *
 *   Manual mode ladder (a per-instance setting in system_settings.operating_mode):
 *     discover  — DEFAULT, on out of the box. Eyes only: scan/monitor/log incidents.
 *     diagnose  — eyes + brain explains incidents. Still no action.
 *     autofix   — diagnose + APPLY, capped at the P4 non-destructive tier.
 *
 *   Auto-pilot (autopilot_enabled): self-escalating meta-mode. Starts read-only and climbs
 *     discover → diagnose → autofix, promoting a level ONLY when the current level has a high
 *     confirmed success rate over N actions (earns trust). Ceiling = non-destructive auto-fix;
 *     it can NEVER self-promote past this. The EFFECTIVE mode is the higher of the manual mode
 *     and the auto-pilot's earned level (auto-pilot only ever expands capability, never shrinks
 *     below what the human explicitly set).
 *
 *   God mode (god_mode_granted): a HUMAN explicitly lifts the non-destructive ceiling so
 *     destructive/novel fixes may auto-apply. Auto-pilot can never reach it.
 *
 *   Killswitch (killswitch_tripped): on a detected loop or catastrophe, auto-pilot AUTO-DEMOTES
 *     to diagnose-only instantly (no human needed to retreat). Demonstrated FAILURE demotes
 *     immediately; promotion back up requires the success gate again + a human killswitch reset.
 *
 * Design pattern: default-deny + earn-trust + auto-retreat (mirrors degradation-mode.ts gating).
 */

import { getDb } from '../db';
import { systemSettings } from '../db/schema';
import { sql, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { ApplyClassification } from '../autofix-apply';

export type OperatingMode = 'discover' | 'diagnose' | 'autofix';

// Numeric rank so we can compare/clamp modes.
const MODE_RANK: Record<OperatingMode, number> = { discover: 0, diagnose: 1, autofix: 2 };
const RANK_MODE: OperatingMode[] = ['discover', 'diagnose', 'autofix'];

// ── Auto-pilot promotion gate tuning ──────────────────────────────────────────
// Promote a level only after this many confirmed successes AND a success rate at/above
// the threshold, with at least the minimum dwell time at the current level.
const PROMOTE_MIN_SUCCESSES = 5;
const PROMOTE_SUCCESS_RATE = 0.9;
const PROMOTE_MIN_DWELL_MS = 30 * 60 * 1000; // 30 min minimum at a level before climbing

export interface ModeState {
  userId: string;
  /** The manual mode the human set. */
  manualMode: OperatingMode;
  /** Auto-pilot on? */
  autopilotEnabled: boolean;
  /** The level auto-pilot has currently earned. */
  autopilotLevel: OperatingMode;
  autopilotSuccessCount: number;
  autopilotFailCount: number;
  autopilotLevelSince: number | null;
  /** Killswitch tripped → auto-pilot clamped to diagnose. */
  killswitchTripped: boolean;
  killswitchReason: string | null;
  /** Human lifted the non-destructive ceiling. */
  godModeGranted: boolean;
  /** Admin opted to include public web/external resources in the learning layer. */
  ragIncludePublic: boolean;
  /**
   * The EFFECTIVE mode after combining manual + auto-pilot + killswitch.
   * This is what gates run against.
   */
  effectiveMode: OperatingMode;
}

interface PrefRow {
  operating_mode: string | null;
  autopilot_enabled: number | null;
  autopilot_level: string | null;
  autopilot_success_count: number | null;
  autopilot_fail_count: number | null;
  autopilot_level_since: number | null;
  killswitch_tripped: number | null;
  killswitch_reason: string | null;
  god_mode_granted: number | null;
  rag_include_public: number | null;
}

function normMode(v: string | null | undefined, fallback: OperatingMode = 'discover'): OperatingMode {
  return v === 'discover' || v === 'diagnose' || v === 'autofix' ? v : fallback;
}

/**
 * Ensure a system_settings row exists (modes default to discover/off).
 */
function ensurePrefsRow(_userId?: string): void {
  const db = getDb();
  const rawDb = (db as any).$client;
  const existing = rawDb.prepare('SELECT id FROM system_settings WHERE id = ?').get('instance') as
    | { id: string }
    | undefined;
  if (!existing) {
    rawDb.prepare(`
      INSERT INTO system_settings (id, operating_mode, autopilot_enabled, autopilot_level, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('instance', 'discover', 0, 'discover', Date.now());
  }
}

/**
 * Read the full mode state and compute the effective mode.
 */
export function getModeState(userId: string = 'instance'): ModeState {
  ensurePrefsRow(userId);
  const db = getDb();
  const rawDb = (db as any).$client;
  const row = rawDb.prepare(`
    SELECT operating_mode, autopilot_enabled, autopilot_level, autopilot_success_count,
           autopilot_fail_count, autopilot_level_since, killswitch_tripped, killswitch_reason,
           god_mode_granted, rag_include_public
    FROM system_settings WHERE id = ?
  `).get('instance') as PrefRow | undefined;

  const manualMode = normMode(row?.operating_mode, 'discover');
  const autopilotEnabled = !!row?.autopilot_enabled;
  let autopilotLevel = normMode(row?.autopilot_level, 'discover');
  const killswitchTripped = !!row?.killswitch_tripped;

  let autopilotContribution: OperatingMode = autopilotEnabled ? autopilotLevel : 'discover';
  if (killswitchTripped && MODE_RANK[autopilotContribution] > MODE_RANK.diagnose) {
    autopilotContribution = 'diagnose';
  }

  const effectiveRank = Math.max(MODE_RANK[manualMode], MODE_RANK[autopilotContribution]);
  const effectiveMode = RANK_MODE[effectiveRank];

  return {
    userId,
    manualMode,
    autopilotEnabled,
    autopilotLevel,
    autopilotSuccessCount: row?.autopilot_success_count ?? 0,
    autopilotFailCount: row?.autopilot_fail_count ?? 0,
    autopilotLevelSince: row?.autopilot_level_since ?? null,
    killswitchTripped,
    killswitchReason: row?.killswitch_reason ?? null,
    godModeGranted: !!row?.god_mode_granted,
    ragIncludePublic: !!row?.rag_include_public,
    effectiveMode,
  };
}

export function canDiagnose(userId: string = 'instance'): boolean {
  return MODE_RANK[getModeState(userId).effectiveMode] >= MODE_RANK.diagnose;
}

export function canAutofix(userId: string = 'instance'): boolean {
  return getModeState(userId).effectiveMode === 'autofix';
}

export type AutonomousDecision = 'apply' | 'park' | 'denied';

export function decideAutonomous(
  userId: string,
  classification: ApplyClassification,
): { decision: AutonomousDecision; reason: string; mode: OperatingMode; godMode: boolean } {
  const state = getModeState(userId);
  const godMode = state.godModeGranted;

  if (state.effectiveMode !== 'autofix') {
    return {
      decision: 'denied',
      reason: `Mode is '${state.effectiveMode}' — autonomous apply requires 'autofix' mode`,
      mode: state.effectiveMode,
      godMode,
    };
  }

  if (classification.decision === 'blocked') {
    return {
      decision: 'denied',
      reason: `Command blocked by hard safety policy: ${classification.reason}`,
      mode: state.effectiveMode,
      godMode,
    };
  }

  if (classification.decision === 'auto') {
    return { decision: 'apply', reason: classification.reason, mode: state.effectiveMode, godMode };
  }

  if (godMode) {
    return {
      decision: 'apply',
      reason: `Above non-destructive ceiling but god mode is granted: ${classification.reason}`,
      mode: state.effectiveMode,
      godMode,
    };
  }
  return {
    decision: 'park',
    reason: `Exceeds non-destructive ceiling — parked for human approval: ${classification.reason}`,
    mode: state.effectiveMode,
    godMode,
  };
}

export function setOperatingMode(userId: string, mode: OperatingMode): void {
  ensurePrefsRow(userId);
  getDb().run(sql`
    UPDATE system_settings SET operating_mode = ${mode}, updated_at = ${Date.now()}
    WHERE id = 'instance'
  `);
}

export function setAutopilot(userId: string, enabled: boolean): void {
  ensurePrefsRow(userId);
  const now = Date.now();
  if (enabled) {
    getDb().run(sql`
      UPDATE system_settings
      SET autopilot_enabled = 1, autopilot_level = 'discover',
          autopilot_success_count = 0, autopilot_fail_count = 0, autopilot_level_since = ${now},
          updated_at = ${now}
      WHERE id = 'instance'
    `);
  } else {
    getDb().run(sql`
      UPDATE system_settings SET autopilot_enabled = 0, updated_at = ${now}
      WHERE id = 'instance'
    `);
  }
}

export function setRagIncludePublic(userId: string, enabled: boolean): void {
  ensurePrefsRow(userId);
  getDb().run(sql`
    UPDATE system_settings SET rag_include_public = ${enabled ? 1 : 0}, updated_at = ${Date.now()}
    WHERE id = 'instance'
  `);
}

export function setGodMode(userId: string, granted: boolean, grantedBy: string): void {
  ensurePrefsRow(userId);
  const now = Date.now();
  getDb().run(sql`
    UPDATE system_settings
    SET god_mode_granted = ${granted ? 1 : 0},
        god_mode_granted_by = ${granted ? grantedBy : null},
        god_mode_granted_at = ${granted ? now : null},
        updated_at = ${now}
    WHERE id = 'instance'
  `);
}

export function tripKillswitch(userId: string, reason: string): void {
  ensurePrefsRow(userId);
  const now = Date.now();
  getDb().run(sql`
    UPDATE system_settings
    SET killswitch_tripped = 1, killswitch_reason = ${reason.slice(0, 500)}, killswitch_at = ${now},
        autopilot_level = 'diagnose', autopilot_success_count = 0,
        autopilot_level_since = ${now}, updated_at = ${now}
    WHERE id = 'instance'
  `);
  console.warn(`[OperatingMode] KILLSWITCH tripped: ${reason}`);
}

export function resetKillswitch(userId: string): void {
  ensurePrefsRow(userId);
  getDb().run(sql`
    UPDATE system_settings
    SET killswitch_tripped = 0, killswitch_reason = NULL, updated_at = ${Date.now()}
    WHERE id = 'instance'
  `);
}

export function recordAutonomousOutcome(
  userId: string,
  success: boolean,
  opts: { loopSignal?: boolean; catastrophe?: string } = {},
): { promoted?: OperatingMode; killswitch?: boolean } {
  const state = getModeState(userId);
  const db = getDb();
  const now = Date.now();

  if (opts.catastrophe) {
    tripKillswitch(userId, `Catastrophe: ${opts.catastrophe}`);
    return { killswitch: true };
  }
  if (opts.loopSignal) {
    tripKillswitch(userId, 'Loop detected — same/similar fix applied repeatedly without resolution');
    return { killswitch: true };
  }

  const rawDb = (db as any).$client;
  if (!state.autopilotEnabled) {
    if (success) {
      rawDb.prepare('UPDATE system_settings SET autopilot_success_count = autopilot_success_count + 1, updated_at = ? WHERE id = ?').run(now, 'instance');
    } else {
      rawDb.prepare('UPDATE system_settings SET autopilot_fail_count = autopilot_fail_count + 1, updated_at = ? WHERE id = ?').run(now, 'instance');
    }
    return {};
  }

  if (success) {
    rawDb.prepare('UPDATE system_settings SET autopilot_success_count = autopilot_success_count + 1, updated_at = ? WHERE id = ?').run(now, 'instance');
  } else {
    rawDb.prepare('UPDATE system_settings SET autopilot_fail_count = autopilot_fail_count + 1, updated_at = ? WHERE id = ?').run(now, 'instance');
  }

  return maybePromote(userId);
}

export function maybePromote(userId: string): { promoted?: OperatingMode } {
  const state = getModeState(userId);
  if (!state.autopilotEnabled || state.killswitchTripped) return {};
  if (state.autopilotLevel === 'autofix') return {};

  const total = state.autopilotSuccessCount + state.autopilotFailCount;
  const rate = total > 0 ? state.autopilotSuccessCount / total : 0;
  const dwell = state.autopilotLevelSince ? Date.now() - state.autopilotLevelSince : Infinity;

  const earned =
    state.autopilotSuccessCount >= PROMOTE_MIN_SUCCESSES &&
    rate >= PROMOTE_SUCCESS_RATE &&
    dwell >= PROMOTE_MIN_DWELL_MS;

  if (!earned) return {};

  const nextRank = Math.min(MODE_RANK[state.autopilotLevel] + 1, MODE_RANK.autofix);
  const next = RANK_MODE[nextRank];
  const now = Date.now();

  getDb().run(sql`
    UPDATE system_settings
    SET autopilot_level = ${next}, autopilot_success_count = 0, autopilot_fail_count = 0,
        autopilot_level_since = ${now}, updated_at = ${now}
    WHERE id = 'instance'
  `);
  console.log(`[OperatingMode] Auto-pilot promoted: ${state.autopilotLevel} → ${next}`);
  return { promoted: next };
}

export interface PendingFix {
  id: string;
  userId: string;
  incidentId: string;
  command: string;
  classification: string | null;
  reason: string | null;
  proposedBy: string;
  status: string;
  createdAt: number;
}

export function parkPendingFix(
  userId: string,
  incidentId: string,
  command: string,
  classification: ApplyClassification,
  reason: string,
  proposedBy: string,
): { id: string; deduped: boolean } {
  const db = getDb();
  const rawDb = (db as any).$client;
  const existing = rawDb.prepare(`
    SELECT id FROM observatory_pending_fixes
    WHERE incident_id = ? AND command = ? AND status = ?
  `).get(incidentId, command, 'pending') as { id: string } | undefined;
  if (existing) return { id: existing.id, deduped: true };

  const id = `pf_${nanoid(14)}`;
  rawDb.prepare(`
    INSERT INTO observatory_pending_fixes
      (id, incident_id, command, classification, reason, proposed_by, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, incidentId, command, JSON.stringify(classification), reason.slice(0, 500), proposedBy, 'pending', Date.now());
  return { id, deduped: false };
}

export function listPendingFixes(userId: string, status = 'pending'): PendingFix[] {
  const db = getDb();
  const rawDb = (db as any).$client;
  const rows = rawDb.prepare(`
    SELECT id, incident_id, command, classification, reason, proposed_by, status, created_at
    FROM observatory_pending_fixes
    WHERE status = ?
    ORDER BY created_at DESC
  `).all(status) as Array<Record<string, any>>;
  return rows.map((r) => ({
    id: r.id,
    userId: userId || 'instance',
    incidentId: r.incident_id,
    command: r.command,
    classification: r.classification,
    reason: r.reason,
    proposedBy: r.proposed_by,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export function getPendingFix(userId: string, id: string): PendingFix | null {
  const db = getDb();
  const rawDb = (db as any).$client;
  const r = rawDb.prepare(`
    SELECT id, incident_id, command, classification, reason, proposed_by, status, created_at
    FROM observatory_pending_fixes WHERE id = ?
  `).get(id) as Record<string, any> | undefined;
  if (!r) return null;
  return {
    id: r.id, userId: userId || 'instance', incidentId: r.incident_id, command: r.command,
    classification: r.classification, reason: r.reason, proposedBy: r.proposed_by,
    status: r.status, createdAt: r.created_at,
  };
}

export function decidePendingFix(
  userId: string,
  id: string,
  status: 'approved' | 'denied',
  decidedBy: string,
  applyResult?: unknown,
): void {
  getDb().run(sql`
    UPDATE observatory_pending_fixes
    SET status = ${status}, decided_by = ${decidedBy}, decided_at = ${Date.now()},
        apply_result = ${applyResult !== undefined ? JSON.stringify(applyResult) : null}
    WHERE id = ${id}
  `);
}
