import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';

/**
 * Above-ceiling pending-fix approval queue (Charlie 2026-06-12).
 *
 *   GET  /app/api/observatory/pending-fix            → list pending (default) or ?status=
 *   POST /app/api/observatory/pending-fix            → decide one
 *        body: { id, decision: 'approve' | 'deny' }
 *
 * When an autonomous remediation exceeds the non-destructive ceiling (and god mode is off), it is
 * parked here against its incident instead of running. A human with manage_settings approves or
 * denies. Approval applies the command through the same Windlass /exec path the gated-autofix uses,
 * with P4's force-confirm (the human IS the confirmation). Denial closes it with no action.
 */

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const userId = locals.workspace?.ownerId || locals.user.id;
  const status = url.searchParams.get('status') || 'pending';
  const { listPendingFixes } = await import('../../../../lib/observatory/operating-mode');
  return json({ fixes: listPendingFixes(userId, status) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../../lib/rbac');
  const block = checkRBAC(locals, 'manage_settings');
  if (block) return block;

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { id, decision } = body || {};
  if (!id || (decision !== 'approve' && decision !== 'deny')) {
    return json({ error: "id and decision ('approve'|'deny') are required" }, 400);
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const { getPendingFix, decidePendingFix } =
    await import('../../../../lib/observatory/operating-mode');

  const fix = getPendingFix(userId, id);
  if (!fix) return json({ error: 'Pending fix not found' }, 404);
  if (fix.status !== 'pending') {
    return json({ error: `Already ${fix.status}` }, 409);
  }

  if (decision === 'deny') {
    decidePendingFix(userId, id, 'denied', locals.user.id);
    return json({ ok: true, decision: 'denied', id });
  }

  // --- approve: apply the command via Windlass /exec (human = the confirmation) ---
  const db = getDb();
  const wConfig = db.select().from(schema.windlassConfig)
    .where(eq(schema.windlassConfig.userId, userId)).get();

  const execViaWindlass = async (cmd: string) => {
    if (!wConfig?.endpointUrl) throw new Error('Windlass not configured — cannot apply remediation');
    const u = wConfig.endpointUrl.replace(/\/$/, '') + '/exec';
    const res = await fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Windlass /exec HTTP ${res.status}`);
    const data: unknown = await res.json();
    return { exitCode: data.exitCode ?? 1, stdout: data.stdout ?? '', stderr: data.stderr ?? '' };
  };

  const { applyRemediation } = await import('../../../../lib/autofix-apply');
  // forceConfirmed=true: an approving human is the explicit confirmation for an 'escalate' command.
  // 'blocked' (destructive shapes) is STILL refused inside applyRemediation even when approved.
  const result = await applyRemediation(fix.command, execViaWindlass, true);

  decidePendingFix(userId, id, 'approved', locals.user.id, result);

  return json({
    ok: result.applied,
    decision: 'approved',
    id,
    result,
  }, result.applied ? 200 : 400);
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
