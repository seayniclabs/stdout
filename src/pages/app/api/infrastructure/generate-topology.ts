/**
 * API: Generate Topology Diagram
 *
 * Generates an animated DashMotion architecture diagram from discovered hosts
 */

import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { discoveredHosts } from '../../../../lib/db/monitoring-schema';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const POST: APIRoute = async ({ locals }) => {
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
      .all();

    // Build DashMotion semantic graph
    const graph = buildDashMotionGraph(hosts);

    // Write graph to temp file
    const tempDir = tmpdir();
    const graphPath = join(tempDir, `topology-${Date.now()}.json`);
    const outputPath = join(tempDir, `topology-${Date.now()}.html`);

    writeFileSync(graphPath, JSON.stringify(graph, null, 2));

    // Call DashMotion layout.py
    const dashMotionPath = join(process.cwd(), 'dashmotion', 'scripts', 'layout.py');

    const html = await new Promise<string>((resolve, reject) => {
      const proc = spawn('python3', [
        dashMotionPath,
        graphPath,
        '--render',
        outputPath
      ]);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`DashMotion failed: ${stderr}`));
          return;
        }

        try {
          const html = readFileSync(outputPath, 'utf-8');
          resolve(html);
        } catch (err) {
          reject(err);
        }
      });
    });

    return new Response(JSON.stringify({ html }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[api/generate-topology] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

function buildDashMotionGraph(hosts: any[]) {
  const nodes: any[] = [];
  const edges: any[] = [];
  const groups: any[] = [];

  // Separate containers from network hosts
  const containers = hosts.filter(h => h.deviceType === 'docker-container');
  const networkHosts = hosts.filter(h => h.deviceType !== 'docker-container');

  // Create groups
  if (containers.length > 0) {
    groups.push({
      id: 'docker',
      label: 'Docker Containers',
    });
  }

  if (networkHosts.length > 0) {
    groups.push({
      id: 'network',
      label: 'Network Infrastructure',
    });
  }

  // Add container nodes
  for (const host of containers) {
    nodes.push({
      id: `host-${host.id}`,
      label: host.hostname || host.ipAddress,
      sublabel: host.ipAddress,
      type: 'service',
      group: 'docker',
    });
  }

  // Add network host nodes
  for (const host of networkHosts) {
    const isGateway = host.ipAddress === '192.168.68.1' || host.hostname?.toLowerCase().includes('router');
    nodes.push({
      id: `host-${host.id}`,
      label: host.hostname || host.ipAddress,
      sublabel: host.ipAddress,
      type: isGateway ? 'infrastructure' : 'component',
      group: 'network',
    });
  }

  // Create edges - simple connections for now
  // Connect all containers to first network host (usually the Docker host itself)
  if (containers.length > 0 && networkHosts.length > 0) {
    const dockerHost = networkHosts.find(h => h.ipAddress.startsWith('192.168.68.89')) || networkHosts[0];
    for (const container of containers) {
      edges.push({
        from: `host-${dockerHost.id}`,
        to: `host-${container.id}`,
        kind: 'data',
      });
    }
  }

  return {
    title: 'Infrastructure Topology',
    subtitle: `${hosts.length} discovered hosts`,
    mode: 'architecture',
    nodes,
    edges,
    groups,
    summary: [
      {
        accent: 'cyan',
        title: 'Containers',
        items: [`${containers.length} Docker containers`],
      },
      {
        accent: 'violet',
        title: 'Network',
        items: [`${networkHosts.length} network hosts`],
      },
      {
        accent: 'rose',
        title: 'Total',
        items: [`${hosts.length} devices discovered`],
      },
    ],
  };
}
