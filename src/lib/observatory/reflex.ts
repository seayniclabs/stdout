/**
 * The autonomic reflex arc (Charlie 2026-06-12).
 *
 * "If the system wires itself, why can't it auto-start?" — it should, and this is the missing piece.
 * Detection self-starts (the Watcher loop ticks and creates incidents). But diagnosis and autofix
 * were endpoint-triggered (a human POST). This wires the REFLEX: when the Watcher creates an
 * incident, it (this module) immediately — with NO HTTP trigger — does what the current operating
 * mode permits:
 *
 *   mode discover  → nothing (eyes only; the incident is logged for a human).
 *   mode diagnose  → auto-diagnose (Ollama + tool-augmented), store the diagnosis.
 *   mode autofix   → diagnose, then attempt GATED autofix on the diagnosis's suggested commands
 *                    (only the non-destructive precedented ones auto-apply; above-ceiling parks for
 *                    approval). Auto-pilot accounting + killswitch apply.
 *
 * Everything is mode-gated through operating-mode.ts and best-effort — a failure in the reflex never
 * breaks the Watcher tick. This is what makes the loop self-running rather than waiting to be poked.
 */

import { getTenantDb, tenantSchema } from '../db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { canDiagnose, canAutofix, decideAutonomous, parkPendingFix, recordAutonomousOutcome } from './operating-mode';

export interface ReflexOutcome {
  incidentId: string;
  diagnosed: boolean;
  toolUsed?: string;
  applied: number;   // commands auto-applied
  parked: number;    // commands parked for approval
  skipped: string;   // reason if nothing happened
}

/**
 * Run the reflex for a single freshly-created incident. Safe to call fire-and-forget.
 */
export async function reflexForIncident(userId: string, incidentId: string): Promise<ReflexOutcome> {
  const base: ReflexOutcome = { incidentId, diagnosed: false, applied: 0, parked: 0, skipped: '' };

  // Mode gate: nothing to do in discover.
  if (!canDiagnose(userId)) {
    return { ...base, skipped: 'discover mode — eyes only' };
  }

  const db = getTenantDb(userId);
  const incident = db.select().from(tenantSchema.incidents)
    .where(eq(tenantSchema.incidents.id, incidentId)).get();
  if (!incident) return { ...base, skipped: 'incident not found' };

  // Resolve the diagnosis model (Ollama by default).
  let credential: { source: string; provider: string; model: string; apiKey: string } | null = null;
  try {
    const { resolveForDiagnostics } = await import('../ai-providers');
    credential = resolveForDiagnostics(userId, 'paid') as any;
  } catch { credential = null; }
  if (!credential) return { ...base, skipped: 'no AI model available' };

  // Stack context.
  let stackContext = 'No stack description provided.';
  if (incident.stackId) {
    const stack = db.select().from(tenantSchema.stacks)
      .where(eq(tenantSchema.stacks.id, incident.stackId)).get();
    if (stack) stackContext = stack.description;
  }

  // Tool-augmented evidence (read-only; the brain may run one diagnostic tool).
  let toolBlock = '';
  let toolUsed: string | undefined;
  try {
    const { augmentWithTool } = await import('./tool-augmented-diagnose');
    const aug = await augmentWithTool({
      userId,
      incidentTitle: incident.title,
      incidentDescription: incident.description,
      credential: { provider: credential.provider, model: credential.model,
        apiKey: credential.source === 'user_key' ? credential.apiKey : '' },
    });
    toolBlock = aug.contextBlock;
    toolUsed = aug.tool;
  } catch { /* best-effort */ }

  // Diagnose.
  let suggestedCommands: string[] = [];
  try {
    const { diagnoseIncident } = await import('../diagnose');
    const result = await diagnoseIncident({
      stackContext,
      incidentDescription: `Title: ${incident.title}\n\n${incident.description}${toolBlock}`,
      pastResolutions: [],
      tier: 'paid',
      apiKey: credential.source === 'user_key' ? credential.apiKey : undefined,
      model: credential.model,
      provider: credential.provider,
    });
    suggestedCommands = result.suggestedCommands || [];

    db.insert(tenantSchema.diagnoses).values({
      id: nanoid(),
      incidentId,
      rootCauses: JSON.stringify(result.rootCauses),
      suggestedCommands: JSON.stringify(result.suggestedCommands),
      matchedIncidentIds: null,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      createdAt: new Date(),
    }).run();
  } catch (err: any) {
    return { ...base, skipped: `diagnosis failed: ${err?.message || 'unknown'}` };
  }

  const out: ReflexOutcome = { ...base, diagnosed: true, toolUsed, skipped: '' };

  // In diagnose mode we stop here (no action).
  if (!canAutofix(userId)) {
    out.skipped = 'diagnose mode — explained, no action';
    return out;
  }

  // autofix mode: route each suggested command through the autonomous gate.
  const { classifyAutoApply, applyRemediation } = await import('../autofix-apply');
  const wConfig = db.select().from(tenantSchema.windlassConfig)
    .where(eq(tenantSchema.windlassConfig.userId, userId)).get();
  const execViaWindlass = async (cmd: string) => {
    if (!wConfig?.endpointUrl) throw new Error('Windlass not configured');
    const url = wConfig.endpointUrl.replace(/\/$/, '') + '/exec';
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }), signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Windlass /exec HTTP ${res.status}`);
    const data: any = await res.json();
    return { exitCode: data.exitCode ?? 1, stdout: data.stdout ?? '', stderr: data.stderr ?? '' };
  };

  // Only consider the first few commands to avoid a runaway; non-destructive ones auto-apply.
  for (const command of suggestedCommands.slice(0, 5)) {
    if (typeof command !== 'string' || !command.trim()) continue;
    const cls = classifyAutoApply(command);
    const verdict = decideAutonomous(userId, cls);

    if (verdict.decision === 'denied') continue;

    if (verdict.decision === 'park') {
      parkPendingFix(userId, incidentId, command, cls, verdict.reason, 'autopilot');
      out.parked++;
      try {
        const { notify } = await import('../notify');
        await notify(userId, {
          event: 'autofix_pending_approval',
          title: `Approval needed: auto-fix for "${incident.title}"`,
          body: `Autonomous remediation exceeds the non-destructive ceiling:\n${command}\n\n${verdict.reason}`,
          url: `/app/incidents/${incidentId}`,
          metadata: { incidentId, command },
        });
      } catch { /* best-effort */ }
      continue;
    }

    // verdict.decision === 'apply' — non-destructive precedented (or god mode).
    try {
      const r = await applyRemediation(command, execViaWindlass, true);
      const ok = r.applied && (r.exitCode === 0 || r.exitCode === undefined);
      if (r.applied) out.applied++;
      recordAutonomousOutcome(userId, ok, {});
    } catch { /* one command failing shouldn't abort the rest */ }
  }

  out.skipped = out.applied || out.parked ? '' : 'autofix mode — no actionable commands';
  return out;
}

/**
 * Run the reflex for a batch of incidents (the Watcher hands it the incidents it just created).
 * Sequential to keep load bounded; each is independent and best-effort.
 */
export async function reflexForIncidents(userId: string, incidentIds: string[]): Promise<ReflexOutcome[]> {
  const results: ReflexOutcome[] = [];
  for (const id of incidentIds) {
    try {
      results.push(await reflexForIncident(userId, id));
    } catch (err: any) {
      results.push({ incidentId: id, diagnosed: false, applied: 0, parked: 0, skipped: `reflex error: ${err?.message || 'unknown'}` });
    }
  }
  return results;
}
