/**
 * Observatory Manual Check Endpoint
 *
 * POST /app/api/observatory/check
 * Triggers an immediate Observatory check for all stacks
 */

import type { APIRoute } from 'astro';
import { runScheduledCheck } from '../../../../lib/observatory/sentinel';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'configure_observatory');
  if (rbacError) return rbacError;

  // CSRF check - accepts header or body
  let body: any = {};
  try { body = await request.json(); } catch { /* Optional body */ }
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const userId = locals.workspace?.ownerId || locals.user!.id;

  try {
    const result = await runScheduledCheck(userId);

    return new Response(JSON.stringify({
      success: true,
      stacksChecked: result.stacksChecked,
      anomaliesDetected: result.anomaliesDetected,
      incidentsCreated: result.incidentsCreated,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    console.error('[Observatory Check API] Error:', error);
    return new Response(JSON.stringify({
      error: 'Check failed',
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
