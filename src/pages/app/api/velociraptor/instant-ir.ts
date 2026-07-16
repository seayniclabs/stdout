import type { APIRoute } from 'astro';
import { instantIRMode } from '../../../../lib/velociraptor';

/**
 * POST /app/api/velociraptor/instant-ir
 *
 * Triggers "Instant IR Mode" — collects all forensic artifacts from a client.
 *
 * Body:
 * ```json
 * {
 *   "clientId": "C.abc123",
 *   "incidentId": 42
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "ok": true,
 *   "flowIds": ["F.abc123", "F.def456", ...]
 * }
 * ```
 */
export const POST: APIRoute = async ({ locals, request }) => {
  // Auth: require valid API token or session
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { clientId?: string; incidentId?: number };
  try {
    body = await request.json();
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.clientId || !body.incidentId) {
    return new Response(JSON.stringify({ error: 'clientId and incidentId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Trigger Instant IR Mode
  try {
    const result = await instantIRMode(body.clientId, body.incidentId, locals.user.id);

    return new Response(JSON.stringify({
      ok: true,
      flowIds: result.flowIds,
      message: `Instant IR Mode activated — collected ${result.flowIds.length} artifacts`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Instant IR error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
