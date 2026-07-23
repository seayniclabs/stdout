import type { APIRoute } from 'astro';
import { instantIRMode } from '../../../../lib/velociraptor';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';

/**
 * POST /app/api/velociraptor/instant-ir
 *
 * Triggers "Instant IR Mode" — collects all forensic artifacts from a client.
 *
 * Body:
 * ```json
 * {
 *   "clientId": "C.abc123",
 *   "incidentId": 42
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "ok": true,
 *   "flowIds": ["F.abc123", "F.def456", ...]
 * }
 * ```
 */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - IR collection is a critical management operation
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  let body: { clientId?: string; incidentId?: number };
  try {
    body = await request.json();
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || (body as any)._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!body.clientId || !body.incidentId) {
    return new Response(JSON.stringify({ error: 'clientId and incidentId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Trigger Instant IR Mode
  try {
    const result = await instantIRMode(body.clientId, body.incidentId, locals.user.id);

    return new Response(JSON.stringify({
      ok: true,
      flowIds: result.flowIds,
      message: `Instant IR Mode activated — collected ${result.flowIds.length} artifacts`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Instant IR error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
