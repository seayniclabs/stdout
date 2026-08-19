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

    // Read the ACTUAL monitor state. This previously counted monitors and then
    // hardcoded healthy=total, degraded=0, down=0 ("will enhance with real data
    // later"), so Bridge would have rendered a permanently-green board no matter
    // what was actually broken. currentStatus/latencyMs/lastCheckedAt are
    // already maintained by the checker.
    const allMonitors = db.select().from(schema.monitors).all();

    // Paused and maintenance monitors are deliberately not being checked;
    // counting them as healthy would overstate the fleet.
    const active = allMonitors.filter((m: any) => !m.paused && !m.maintenance);

    const byStatus = (s: string) =>
      active.filter((m: any) => (m.currentStatus ?? 'unknown') === s);

    const up = byStatus('up').length;
    const down = byStatus('down').length;
    const degraded = byStatus('degraded').length;
    const unknown = byStatus('unknown').length;

    // Worst state wins, and "no data" is NOT healthy — an empty or all-unknown
    // fleet reports unknown rather than green.
    const overall_status =
      active.length === 0 || unknown === active.length
        ? ('unknown' as const)
        : down > 0
          ? ('down' as const)
          : degraded > 0 || unknown > 0
            ? ('degraded' as const)
            : ('healthy' as const);

    // Per-service detail, shaped for Bridge's infra board: {id, name, status}.
    const services = active.map((m: any) => ({
      id: m.id,
      name: m.name,
      status: m.currentStatus ?? 'unknown',
      type: m.type,
      target: m.target,
      latency: m.latencyMs ?? null,
      last_checked_at: m.lastCheckedAt ?? null,
    }));

    const critical_alerts = services
      .filter((s) => s.status === 'down')
      .map((s) => ({ id: s.id, name: s.name, target: s.target }));

    const response = {
      ok: true,
      timestamp: new Date().toISOString(),
      overall_status,
      services: {
        total: active.length,
        healthy: up,
        degraded,
        down,
        unknown,
      },
      monitors: {
        total: allMonitors.length,
        active: active.length,
        up,
        down,
        degraded,
        unknown,
        paused: allMonitors.length - active.length,
      },
      // Detail array Bridge maps by id.
      items: services,
      critical_alerts,
      last_incident: null,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, max-age=30',
        'Access-Control-Allow-Origin': 'https://bridge.seaynicroute.com',
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
      'Access-Control-Allow-Origin': 'https://bridge.seaynicroute.com',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'X-API-Key',
    },
  });
};
