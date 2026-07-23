import type { APIRoute } from 'astro';
import { isolateVelociraptorClient, getVelociraptorConfig } from '../../../../lib/velociraptor';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';

/**
 * POST /app/api/velociraptor/isolate
 *
 * Emergency isolation — blocks network access for a client.
 *
 * Body:
 * ```json
 * {
 *   "clientId": "C.abc123",
 *   "reason": "Suspected ransomware",
 *   "duration": 3600
 * }
 * ```
 */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - isolating clients is a critical management operation
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  let body: { clientId?: string; reason?: string; duration?: number };
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

  if (!body.clientId || !body.reason) {
    return new Response(JSON.stringify({ error: 'clientId and reason are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = getVelociraptorConfig(locals.user.id);
  if (!config || !config.enabled) {
    return new Response(JSON.stringify({ error: 'Velociraptor not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Trigger isolation
  try {
    await isolateVelociraptorClient(
      {
        clientId: body.clientId,
        reason: body.reason,
        duration: body.duration || 3600,
      },
      config
    );

    return new Response(JSON.stringify({
      ok: true,
      message: `Client ${body.clientId} isolated successfully`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Velociraptor isolation error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
