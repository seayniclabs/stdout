/**
 * POST /app/api/discovery/scan
 * Trigger passive discovery scan
 */

import type { APIRoute } from 'astro';
import { runPassiveDiscovery } from '../../../../lib/discovery/passive-discovery';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  // CSRF check
  let body: any = {};
  try { body = await request.json(); } catch { /* Optional body */ }
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  try {
    const apps = await runPassiveDiscovery();

    return new Response(JSON.stringify({
      success: true,
      discovered: apps.length,
      applications: apps,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Discovery scan failed:', error);

    return new Response(JSON.stringify({
      error: 'Discovery scan failed',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
