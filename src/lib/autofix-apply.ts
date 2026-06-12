/**
 * Gated auto-fix apply (P4).
 *
 * The brain can generate a remediation plan (autofix.ts `plan`/`patch`), but APPLYING a fix
 * autonomously is the dangerous step. This implements the lab's gated-autofix contract:
 *
 *   A fix runs automatically ONLY if it is reversible AND non-destructive AND precedented.
 *   Anything else is ESCALATED with a structured diagnosis — never silently applied, never
 *   silently dropped.
 *
 * Layers:
 *   1. assertAutofixCommandAllowed (autofix-exec-policy.ts) — hard block on destructive shapes
 *      (rm -rf, dd, mkfs, pipe-to-shell, chaining, metacharacters). Non-negotiable.
 *   2. classifyAutoApply — is this command in the PRECEDENTED auto-apply set (reversible +
 *      non-destructive)? Only `docker restart|start|stop <container>` and equivalent qualify.
 *   3. Execution goes through Windlass /exec (the single audited execution path).
 *
 * The decision is returned to the caller (the API) which records it and either executes or
 * escalates. This module makes the SAFETY decision; it does not itself talk to the network
 * except via the injected exec function.
 */

import { assertAutofixCommandAllowed } from './autofix-exec-policy';

export type ApplyDecision = 'auto' | 'escalate' | 'blocked';

export interface ApplyClassification {
  decision: ApplyDecision;
  reason: string;
  reversible: boolean;
  destructive: boolean;
  precedented: boolean;
}

/**
 * Precedented, reversible, non-destructive actions that may auto-apply. Each entry is a matcher
 * against the normalized command plus a human note on WHY it's safe/reversible.
 */
const AUTO_APPLY_RULES: Array<{ test: RegExp; why: string }> = [
  // Container lifecycle — fully reversible (start<->stop), no data loss, the canonical safe fix.
  { test: /^docker (restart|start|stop) [a-z0-9_.-]+$/i, why: 'container lifecycle — reversible, no data loss' },
  { test: /^docker-compose (restart|up -d|stop) [a-z0-9_.-]+$/i, why: 'compose lifecycle — reversible' },
];

/**
 * Classify a single remediation command into auto / escalate / blocked.
 */
export function classifyAutoApply(command: string): ApplyClassification {
  // Layer 1: hard safety block (destructive shapes, chaining, metacharacters).
  const blockReason = assertAutofixCommandAllowed(command);
  if (blockReason) {
    return {
      decision: 'blocked',
      reason: blockReason,
      reversible: false,
      destructive: true,
      precedented: false,
    };
  }

  const norm = command.trim().replace(/\s+/g, ' ');

  // Layer 2: is it in the precedented auto-apply set?
  const rule = AUTO_APPLY_RULES.find((r) => r.test.test(norm));
  if (rule) {
    return {
      decision: 'auto',
      reason: `Precedented safe action: ${rule.why}`,
      reversible: true,
      destructive: false,
      precedented: true,
    };
  }

  // Passed the hard safety gate but isn't a known-reversible precedented action.
  // Could be a read-only diagnostic (dig/curl/cat) — safe to run, but applying it changes nothing,
  // so there's no value auto-"fixing" with it; or it's an unrecognized mutation we won't risk.
  // Either way: escalate for human/brain confirmation rather than auto-apply.
  return {
    decision: 'escalate',
    reason: 'Command is not in the precedented reversible auto-apply set — escalating for confirmation',
    reversible: false,
    destructive: false,
    precedented: false,
  };
}

export interface ApplyResult {
  applied: boolean;
  decision: ApplyDecision;
  reason: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

/**
 * Apply a remediation command via Windlass /exec, but only if it classifies as 'auto'.
 * `execViaWindlass` is injected (so this stays testable + the network call lives in one place).
 *
 * @param command          the remediation command
 * @param execViaWindlass  runs the command on the host via Windlass, returns its result
 * @param forceConfirmed   operator explicitly confirmed an 'escalate' command → allow it to run
 */
export async function applyRemediation(
  command: string,
  execViaWindlass: (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  forceConfirmed = false,
): Promise<ApplyResult> {
  const cls = classifyAutoApply(command);

  // 'blocked' is never run, even with confirmation — these are destructive shapes.
  if (cls.decision === 'blocked') {
    return { applied: false, decision: 'blocked', reason: cls.reason };
  }

  // 'escalate' runs only when an operator explicitly confirmed it.
  if (cls.decision === 'escalate' && !forceConfirmed) {
    return { applied: false, decision: 'escalate', reason: cls.reason };
  }

  try {
    const res = await execViaWindlass(command);
    return {
      applied: true,
      decision: forceConfirmed && cls.decision === 'escalate' ? 'escalate' : 'auto',
      reason: forceConfirmed && cls.decision === 'escalate'
        ? 'Applied after explicit operator confirmation'
        : cls.reason,
      exitCode: res.exitCode,
      stdout: res.stdout?.slice(0, 8192),
      stderr: res.stderr?.slice(0, 8192),
    };
  } catch (err: any) {
    return { applied: false, decision: cls.decision, reason: cls.reason, error: err.message };
  }
}
