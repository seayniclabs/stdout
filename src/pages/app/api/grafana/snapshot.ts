import type { APIRoute} from 'astro';
import { getGrafanaConfig, createGrafanaSnapshot } from '../../../../lib/grafana';
import { requireAuth } from '../../../../lib/rbac';

/**
 * POST /app/api/grafana/snapshot
 * Create a Grafana dashboard snapshot (for incident archival)
 */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  const userId = locals.workspace?.ownerId || locals.user.id;
  const config = getGrafanaConfig(userId);

  if (!config) {
    return new Response(JSON.stringify({ error: 'Grafana not configured' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { dashboardUid, name, expires } = body;

    // CSRF check
    const { validateCsrf } = await import('../../../../middleware');
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!dashboardUid) {
      return new Response(JSON.stringify({ error: 'dashboardUid required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const snapshot = await createGrafanaSnapshot(config, dashboardUid, {
      name,
      expires: expires || 604800, // 7 days default
    });

    if (!snapshot) {
      return new Response(JSON.stringify({ error: 'Snapshot creation failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      url: snapshot.url,
      deleteUrl: snapshot.deleteUrl
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Grafana Snapshot] Error:', message);

    return new Response(JSON.stringify({
      error: 'Failed to create snapshot',
      details: message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
