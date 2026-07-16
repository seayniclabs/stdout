import type { APIRoute} from 'astro';
import { getGrafanaConfig, createGrafanaSnapshot } from '../../../../lib/grafana';

/**
 * POST /app/api/grafana/snapshot
 * Create a Grafana dashboard snapshot (for incident archival)
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const config = getGrafanaConfig(userId);

  if (!config) {
    return new Response(JSON.stringify({ error: 'Grafana not configured' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { dashboardUid, name, expires } = await request.json();

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
