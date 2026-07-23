import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { SyncEngine } from '../../../../lib/ticketing/sync/SyncEngine';
import { requireAuth } from '../../../../lib/rbac';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  try {
    const body = await request.json();
    const { connectorId } = body;

    // CSRF check
    const { validateCsrf } = await import('../../../../middleware');
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDb();
    const syncEngine = new SyncEngine(db as any, locals.user.id);

    let results;

    if (connectorId) {
      // Sync specific connector
      const result = await syncEngine.syncConnector(connectorId);
      results = { [connectorId]: result };
    } else {
      // Sync all connectors
      results = await syncEngine.syncAll();
      results = Object.fromEntries(results);
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[ticketing/sync] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Sync failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
