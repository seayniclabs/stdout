/**
 * API: Get Ignored Hosts + Un-ignore
 *
 * GET: List all ignored devices
 * DELETE: Un-ignore a device
 */

import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { ignoredDiscoveries } from '../../../../lib/db/monitoring-schema';
import { unignoreDevice } from '../../../../lib/discovery/connection-orchestrator';
import { eq } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getDb();
    const ignored = await db.select().from(ignoredDiscoveries).all();

    return new Response(JSON.stringify(ignored), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[api/ignored-hosts] GET error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

export const DELETE: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { uniqueId } = body;

    if (!uniqueId) {
      return new Response(JSON.stringify({ error: 'Missing required field: uniqueId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await unignoreDevice(uniqueId);

    if (result.success) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({ error: result.error || 'Failed to un-ignore device' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('[api/ignored-hosts] DELETE error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
