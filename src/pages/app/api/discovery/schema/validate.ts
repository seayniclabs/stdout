import type { APIRoute } from 'astro';
import { validateNmapData } from '../../../../../lib/discovery/nmap-parser';
import { requireAuth } from '../../../../../lib/rbac';

/**
 * POST /app/api/discovery/schema/validate
 *
 * Validates Nmap XML or JSON data against the discovery ingestion schema constraints.
 * Enforces strict typing (port range), required fields (valid IP/MAC), and reports warnings/errors.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'view');
  if (rbacBlock) return rbacBlock;

  // CSRF check
  const { validateCsrf } = await import('../../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token');
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const contentType = request.headers.get('content-type') || '';
  let payload = '';

  try {
    payload = await request.text();
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: `Failed to read request body: ${error instanceof Error ? error.message : String(error)}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = validateNmapData(payload, contentType);

  return new Response(JSON.stringify({
    valid: result.valid,
    error: result.valid ? undefined : 'Schema validation failed',
    errors: result.errors,
    summary: {
      hostsCount: result.hosts.length,
      servicesCount: result.hosts.reduce((sum, h) => sum + h.ports.length, 0),
    },
    hosts: result.hosts,
  }), {
    status: result.valid ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
};
