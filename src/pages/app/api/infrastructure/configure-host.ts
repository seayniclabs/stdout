/**
 * API: Configure Discovered Host
 *
 * Test connection with user-provided credentials
 */

import type { APIRoute } from 'astro';
import { testConnection } from '../../../../lib/discovery/connection-orchestrator';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { hostId, integrationType, config } = body;

    if (!hostId || !integrationType || !config) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: hostId, integrationType, config' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const result = await testConnection(hostId, integrationType, config);

    if (result.success) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({ error: result.error || 'Connection test failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('[api/configure-host] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
