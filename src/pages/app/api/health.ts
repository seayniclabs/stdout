import type { APIRoute } from 'astro';
import { getStatus } from '../../../lib/observatory/degradation-mode';

/**
 * Health Check Endpoint
 *
 * Returns system health status including Observatory degradation mode.
 * PUBLIC endpoint (no auth required).
 *
 * GET /app/api/health
 */
export const GET: APIRoute = async () => {
  try {
    const degradationStatus = getStatus();

    const health = {
      ok: true,
      timestamp: new Date().toISOString(),
      version: '1.2.1',
      components: {
        core: {
          status: 'operational',
          description: 'StdOut Core incident tracking',
        },
        observatory: {
          status: degradationStatus.enabled ? 'degraded' : 'operational',
          description: degradationStatus.enabled
            ? 'Operating in degradation mode (heuristic-only anomaly detection)'
            : 'Full Observatory features enabled',
          degradationReason: degradationStatus.reason || null,
          capabilities: degradationStatus.capabilities,
        },
      },
    };

    return new Response(JSON.stringify(health), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, max-age=30',
      },
    });
  } catch (error) {
    console.error('[health] Error:', error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Health check failed',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
