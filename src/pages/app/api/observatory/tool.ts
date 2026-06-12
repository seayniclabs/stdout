import type { APIRoute } from 'astro';

/**
 * Observatory tool-invocation endpoint (P7b).
 *
 *   GET  /app/api/observatory/tool          → manifest of available tools
 *   POST /app/api/observatory/tool          → run a tool
 *        body: { tool, args?, allowGated?, reason? }
 *
 * This is the brain's hands: it lets the Analyst (and operators) run allowlisted diagnostic
 * tools (dig, nmap, tshark, trivy, zeek) inside the toolbox sidecars, with per-tool arg
 * validation, safety-class gating, and full audit. Gated tools require allowGated=true AND
 * 'manage'-level RBAC.
 */

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const { listTools } = await import('../../../../lib/observatory/toolbox');
  return json({ tools: listTools() });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../../lib/rbac');
  // Running a diagnostic tool is an action — require at least 'create'.
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { tool, args, allowGated, reason } = body || {};
  if (!tool || typeof tool !== 'string') {
    return json({ error: 'tool is required' }, 400);
  }

  // Gated tools additionally require operator-level RBAC ('manage_settings').
  if (allowGated) {
    const manageBlock = checkRBAC(locals, 'manage_settings');
    if (manageBlock) return json({ error: 'gated tools require manage_settings permission' }, 403);
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const { runTool } = await import('../../../../lib/observatory/toolbox');

  const result = await runTool({
    tool,
    args: args && typeof args === 'object' ? args : {},
    allowGated: Boolean(allowGated),
    userId,
    reason: typeof reason === 'string' ? reason.slice(0, 200) : undefined,
  });

  return json(result, result.ok ? 200 : 400);
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
