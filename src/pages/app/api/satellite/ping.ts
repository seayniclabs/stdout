import type { APIRoute } from 'astro';

/**
 * GET /app/api/satellite/ping
 *
 * Unauthenticated identity endpoint. Satellite agents probe this URL during
 * auto-discovery to verify they've found a StdOut instance before registering.
 * Returns enough information for the satellite to know it has the right host.
 */
export const GET: APIRoute = async () => {
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
    },
  });
};
