import type { APIRoute } from 'astro';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

/**
 * Observatory operating-mode management (Charlie 2026-06-12).
 *
 *   GET  /app/api/observatory/mode   → current ModeState (mode, auto-pilot, killswitch, god mode)
 *   POST /app/api/observatory/mode   → mutate; body.op ∈
 *        { setMode | setAutopilot | setGodMode | resetKillswitch }
 *
 * Reading state needs only an authenticated user. Every MUTATION requires configure_observatory —
 * changing what the autonomous brain is allowed to do is an operator-level decision. God mode
 * (lifting the non-destructive ceiling) is the most privileged and is human-only by construction
 * (auto-pilot has no code path that can set it).
 */

export const GET: APIRoute = async ({ locals }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  const userId = locals.workspace?.ownerId || locals.user!.id;
  const { getModeState } = await import('../../../../lib/observatory/operating-mode');
  return json({ state: getModeState(userId) });
};

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - Observatory configuration requires configure_observatory permission
  const rbacError = checkRBAC(locals, 'configure_observatory');
  if (rbacError) return rbacError;

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return json({ error: 'CSRF token validation failed' }, 403);
  }

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
    case 'setRagIncludePublic': {
      // Admin opt-in to include public web/external resources in the learning layer (off default).
      const { setRagIncludePublic } = await import('../../../../lib/observatory/operating-mode');
      setRagIncludePublic(userId, Boolean(body.enabled));
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
