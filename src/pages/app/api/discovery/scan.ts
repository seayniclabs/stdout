/**
 * POST /app/api/discovery/scan
 * Trigger passive discovery scan
 */

import type { APIRoute } from 'astro';
import { runPassiveDiscovery } from '../../../../lib/discovery/passive-discovery';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const apps = await runPassiveDiscovery();

    return new Response(JSON.stringify({
      success: true,
      discovered: apps.length,
      applications: apps,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Discovery scan failed:', error);

    return new Response(JSON.stringify({
      error: 'Discovery scan failed',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
