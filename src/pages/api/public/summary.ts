import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';

/**
 * Public Summary Endpoint for Bridge Integration
 *
 * Returns aggregate health summary for command center widget.
 * PUBLIC endpoint with API key authentication.
 * RATE LIMITED: 60 requests per minute.
 *
 * GET /app/api/public/summary
 * Headers:
 *   X-API-Key: <bridge_api_key>
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(apiKey: string, maxRequests: number = 60, windowMs: number = 60000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(apiKey);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(apiKey, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

function validateApiKey(providedKey: string | null): boolean {
  if (!providedKey) return false;

  // For now, accept any key starting with "stdout_"
  // TODO: Implement proper bcrypt validation against api_keys table
  return providedKey.startsWith('stdout_');
}

export const GET: APIRoute = async ({ request }) => {
  // API Key authentication
  const apiKey = request.headers.get('x-api-key');

  if (!validateApiKey(apiKey)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting
  if (!checkRateLimit(apiKey!, 60, 60000)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    });
  }

  try {
    const db = getDb();

    // Get all monitors (simplified count)
    const allMonitors = db.select().from(schema.monitors).all();
    const totalMonitors = allMonitors.length;

    // For now, return basic stats (will enhance with real data later)
    const response = {
      ok: true,
      timestamp: new Date().toISOString(),
      overall_status: 'healthy' as const,
      services: {
        total: totalMonitors,
        healthy: totalMonitors,
        degraded: 0,
        down: 0,
      },
      monitors: {
        total: totalMonitors,
        up: totalMonitors,
        down: 0,
      },
      critical_alerts: [],
      last_incident: null,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, max-age=30',
        'Access-Control-Allow-Origin': 'http://localhost:8118',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'X-API-Key',
      },
    });
  } catch (error) {
    console.error('[public/summary] Error:', error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Failed to generate summary',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

// OPTIONS handler for CORS preflight
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'http://localhost:8118',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'X-API-Key',
    },
  });
};
