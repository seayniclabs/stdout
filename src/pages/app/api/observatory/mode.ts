import type { APIRoute } from 'astro';

/**
 * Observatory operating-mode management (Charlie 2026-06-12).
 *
 *   GET  /app/api/observatory/mode   → current ModeState (mode, auto-pilot, killswitch, god mode)
 *   POST /app/api/observatory/mode   → mutate; body.op ∈
 *        { setMode | setAutopilot | setGodMode | resetKillswitch }
 *
 * Reading state needs only an authenticated user. Every MUTATION requires manage_settings —
 * changing what the autonomous brain is allowed to do is an operator-level decision. God mode
 * (lifting the non-destructive ceiling) is the most privileged and is human-only by construction
 * (auto-pilot has no code path that can set it).
 */

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const userId = locals.workspace?.ownerId || locals.user.id;
  const { getModeState } = await import('../../../../lib/observatory/operating-mode');
  return json({ state: getModeState(userId) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../../lib/rbac');
  const block = checkRBAC(locals, 'manage_settings');
  if (block) return block;

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { op } = body || {};
  const userId = locals.workspace?.ownerId || locals.user.id;
  const mod = await import('../../../../lib/observatory/operating-mode');

  switch (op) {
    case 'setMode': {
      const mode = body.mode;
      if (mode !== 'discover' && mode !== 'diagnose' && mode !== 'autofix') {
        return json({ error: "mode must be 'discover' | 'diagnose' | 'autofix'" }, 400);
      }
      mod.setOperatingMode(userId, mode);
      break;
    }
    case 'setAutopilot': {
      mod.setAutopilot(userId, Boolean(body.enabled));
      break;
    }
    case 'setGodMode': {
      // The only path that can grant god mode. Records who granted it.
      mod.setGodMode(userId, Boolean(body.granted), locals.user.id);
      break;
    }
    case 'resetKillswitch': {
      mod.resetKillswitch(userId);
      break;
    }
    default:
      return json({ error: `Unknown op: ${op}` }, 400);
  }

  return json({ ok: true, state: mod.getModeState(userId) });
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
