import type { APIRoute } from 'astro';
import {
  getInfluxConfig,
  queryContainerMetrics,
  queryCurrentResources,
} from '../../../lib/influx';
import {
  getPrometheusConfig,
  queryPrometheusContainerMetrics,
  queryPrometheusCurrentResources,
} from '../../../lib/prometheus';
import { requireAuth } from '../../../lib/rbac';

/**
 * Metrics API — proxies InfluxDB queries through StdOut.
 *
 * GET /app/api/metrics?type=container&name=n8n&range=60
 * GET /app/api/metrics?type=resources&names=n8n,plex,homepage
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const userId = locals.workspace?.ownerId || locals.user.id;
  const influxConfig = getInfluxConfig(userId);
  const prometheusConfig = influxConfig ? null : getPrometheusConfig(userId);

  if (!influxConfig && !prometheusConfig) {
    return new Response(JSON.stringify({ configured: false, data: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const source = influxConfig ? 'influxdb' : 'prometheus';

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
    const metrics = influxConfig
      ? await queryContainerMetrics(influxConfig, name, range)
      : await queryPrometheusContainerMetrics(prometheusConfig!, name, range);

    return new Response(JSON.stringify({ configured: true, source, data: metrics }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Current resource snapshots ---
  if (type === 'resources') {
    const namesParam = url.searchParams.get('names');
    const names = namesParam ? namesParam.split(',').map(n => n.trim()).filter(Boolean) : undefined;
    const resources = influxConfig
      ? await queryCurrentResources(influxConfig, names)
      : await queryPrometheusCurrentResources(prometheusConfig!, names);

    return new Response(JSON.stringify({ configured: true, source, data: resources }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'type parameter required (container|resources)' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
