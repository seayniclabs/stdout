import type { APIRoute } from 'astro';
import {
  getInfluxConfig,
  queryContainerMetrics,
  queryCurrentResources,
} from '../../../lib/influx';

/**
 * Metrics API — proxies InfluxDB queries through StdOut.
 *
 * GET /app/api/metrics?type=container&name=n8n&range=60
 * GET /app/api/metrics?type=resources&names=n8n,plex,homepage
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const config = getInfluxConfig(userId);

  if (!config) {
    return new Response(JSON.stringify({ configured: false, data: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const type = url.searchParams.get('type');

  // --- Container metrics (CPU/mem/net timeline) ---
  if (type === 'container') {
    const name = url.searchParams.get('name');
    if (!name) {
      return new Response(JSON.stringify({ error: 'name parameter required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const range = parseInt(url.searchParams.get('range') || '60');
    const metrics = await queryContainerMetrics(config, name, range);

    return new Response(JSON.stringify({ configured: true, data: metrics }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Current resource snapshots ---
  if (type === 'resources') {
    const namesParam = url.searchParams.get('names');
    const names = namesParam ? namesParam.split(',').map(n => n.trim()).filter(Boolean) : undefined;
    const resources = await queryCurrentResources(config, names);

    return new Response(JSON.stringify({ configured: true, data: resources }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'type parameter required (container|resources)' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
