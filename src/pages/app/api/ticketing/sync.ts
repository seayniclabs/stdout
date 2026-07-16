import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { SyncEngine } from '../../../../lib/ticketing/sync/SyncEngine';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { connectorId } = body;

    const db = getDb();
    const syncEngine = new SyncEngine(db as any, session.id);

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
