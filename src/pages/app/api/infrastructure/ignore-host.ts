/**
 * API: Ignore Discovered Host
 *
 * Add device to ignore list and skip in future scans
 */

import type { APIRoute} from 'astro';
import { ignoreDevice } from '../../../../lib/discovery/connection-orchestrator';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { hostId, reason } = body;

    if (!hostId) {
      return new Response(JSON.stringify({ error: 'Missing required field: hostId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await ignoreDevice(hostId, reason || 'User ignored');

    if (result.success) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({ error: result.error || 'Failed to ignore device' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('[api/ignore-host] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
