import type { APIRoute } from 'astro';
import { fireAlert } from '../../../../lib/alert-router';
import { requireAuth } from '../../../../lib/rbac';

const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);

/**
 * POST /app/api/windlass/event
 * Bearer-token-authenticated ingest endpoint for external systems (n8n, scripts).
 * Accepts an event, evaluates suppression rules, and dispatches to alert channels.
 */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { eventType, severity, title, detail, serviceId } = body;

  if (!eventType || !severity || !title) {
    return new Response(JSON.stringify({ error: 'eventType, severity, and title are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!VALID_SEVERITIES.has(severity)) {
    return new Response(JSON.stringify({ error: 'severity must be info, warning, or critical' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await fireAlert({
    userId: locals.user.id,
    serviceId: serviceId ?? null,
    eventType,
    severity,
    title,
    detail,
  });

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};
