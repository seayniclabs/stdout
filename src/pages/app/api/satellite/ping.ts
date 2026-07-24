import type { APIRoute } from 'astro';
import { isRateLimited, getRateLimitHeaders, getClientIdentifier } from '../../../../middleware/rate-limit';

/**
 * GET /app/api/satellite/ping
 *
 * Unauthenticated identity endpoint. Satellite agents probe this URL during
 * auto-discovery to verify they've found a StdOut instance before registering.
 * Returns enough information for the satellite to know it has the right host.
 * RATE LIMITED: 100 requests per 15 minutes per IP.
 */
export const GET: APIRoute = async ({ request }) => {
  const clientId = getClientIdentifier(request);
  if (isRateLimited(clientId)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
    });
  }

  const rateLimitHeaders = getRateLimitHeaders(clientId);
  return new Response(JSON.stringify({
    service: 'stdout',
    version: '1',
    capabilities: ['satellite'],
    register_url: '/app/api/satellite/nodes',
    report_url: '/app/api/satellite/report',
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...rateLimitHeaders,
    },
  });
};
