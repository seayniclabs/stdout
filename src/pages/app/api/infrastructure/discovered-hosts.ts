/**
 * API: Get Discovered Hosts (grouped by connection status)
 *
 * Returns discovered devices grouped for Home Assistant-style UI
 */

import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { discoveredHosts } from '../../../../lib/db/monitoring-schema';
import { desc } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getDb();

    // Get all discovered hosts
    const hosts = await db
      .select()
      .from(discoveredHosts)
      .orderBy(desc(discoveredHosts.discoveredAt))
      .all();

    // Parse JSON fields
    const hostsWithParsed = hosts.map(host => ({
      ...host,
      openPorts: host.openPorts ? JSON.parse(host.openPorts) : [],
      services: host.services ? JSON.parse(host.services) : [],
      credentials: host.credentials ? JSON.parse(host.credentials) : null,
    }));

    // Group by connection status
    const grouped = {
      connected: hostsWithParsed.filter(h => h.connectionStatus === 'connected'),
      needsConfig: hostsWithParsed.filter(h => h.connectionStatus === 'needs_config'),
      discovered: hostsWithParsed.filter(h => h.connectionStatus === 'discovered'),
      connecting: hostsWithParsed.filter(h => h.connectionStatus === 'connecting'),
      ignored: hostsWithParsed.filter(h => h.connectionStatus === 'ignored'),
      failed: hostsWithParsed.filter(h => h.connectionStatus === 'failed'),
    };

    return new Response(JSON.stringify(grouped), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[api/discovered-hosts] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
