import type { APIRoute } from 'astro';
import { getGrafanaConfig, listGrafanaDashboards, buildGrafanaDashboardUrl } from '../../../../lib/grafana';

/**
 * GET /app/api/grafana/dashboards
 * List Grafana dashboards and build URLs with time ranges
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const config = getGrafanaConfig(userId);

  if (!config) {
    return new Response(JSON.stringify({ configured: false, dashboards: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const dashboards = await listGrafanaDashboards(config);

    // If requesting a specific dashboard URL with time range
    const dashboardUid = url.searchParams.get('uid');
    if (dashboardUid) {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const vars = url.searchParams.get('vars');

      const dashboardUrl = buildGrafanaDashboardUrl(config, dashboardUid, {
        from: from ? parseInt(from) : undefined,
        to: to ? parseInt(to) : undefined,
        vars: vars ? JSON.parse(vars) : undefined,
      });

      return new Response(JSON.stringify({
        configured: true,
        url: dashboardUrl
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return full list
    return new Response(JSON.stringify({
      configured: true,
      dashboards
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Grafana API] Error:', message);

    return new Response(JSON.stringify({
      error: 'Failed to fetch Grafana dashboards',
      details: message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
