import type { APIRoute } from 'astro';
import { getSuricataIngestStatus } from '../../../../lib/suricata-ingest';
import { getSuricataMetrics, metricsPrometheusText } from '../../../../lib/suricata';
import { requireAuth } from '../../../../lib/rbac';

/**
 * GET /app/api/suricata/status
 * Background ingest status (file-tail / Redis list|stream) + metrics.
 *
 * Query: ?format=prometheus — plain-text Prometheus counters.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  // Prometheus format is public for scraping, but requires auth for JSON
  if (url.searchParams.get('format') === 'prometheus') {
    return new Response(metricsPrometheusText(), {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  }

  // Auth check for JSON response
  const authError = requireAuth(locals);
  if (authError) return authError;

  const status = getSuricataIngestStatus();
  const mode = (process.env.SURICATA_REDIS_MODE || 'list').toLowerCase() === 'stream'
    ? 'stream'
    : 'list';

  return new Response(JSON.stringify({
    ok: true,
    ...status,
    metrics: getSuricataMetrics(),
    webhookPath: '/app/api/suricata/webhook',
    env: {
      evePath: process.env.SURICATA_EVE_PATH || null,
      redisUrl: process.env.SURICATA_REDIS_URL ? '[set]' : null,
      redisMode: mode,
      redisKey: mode === 'stream'
        ? (process.env.SURICATA_REDIS_STREAM || 'eve_alerts')
        : (process.env.SURICATA_REDIS_KEY || 'suricata'),
      redisGroup: mode === 'stream' ? (process.env.SURICATA_REDIS_GROUP || 'stream') : null,
      autoFix: (process.env.SURICATA_AUTO_FIX || 'true').toLowerCase() !== 'false',
      correlateWindowSec: Number(process.env.SURICATA_CORRELATE_WINDOW_SEC) || 300,
      correlateThreshold: Number(process.env.SURICATA_CORRELATE_THRESHOLD) || 3,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
