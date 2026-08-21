import type { APIRoute } from 'astro';
import { getSqlite } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/rbac';

/**
 * Network Topology Visualization API
 * Generates animated SVG network diagram showing devices, services, and connections
 *
 * Inspired by dashmotion (https://github.com/csthink/dashmotion)
 * Uses dashed connectors and traveling dots to show network flow
 */

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'view');
  if (rbacBlock) return rbacBlock;

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token');
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getSqlite();

  // Get all entities and relationships
  const entities = db.prepare(`
    SELECT id, type, name, properties
    FROM entities
    ORDER BY type, name
  `).all() as Array<{
    id: string;
    type: string;
    name: string;
    properties: string;
  }>;

  const relationships = db.prepare(`
    SELECT source_id, target_id, type, metadata
    FROM entity_relationships
  `).all() as Array<{
    source_id: string;
    target_id: string;
    type: string;
    metadata: string | null;
  }>;

  // Also get monitors for service → device connections
  const monitors = db.prepare(`
    SELECT id, name, type, target, current_status
    FROM monitors
  `).all() as Array<{
    id: string;
    name: string;
    type: string;
    target: string;
    current_status: string;
  }>;

  // Build topology structure
  const nodes = entities.map(e => {
    let props: any = {};
    try {
      props = JSON.parse(e.properties || '{}');
    } catch (error: unknown) { /* Intentionally ignored */ }

    return {
      id: e.id,
      label: e.name,
      type: e.type,
      ip: props.ip,
      vendor: props.vendor,
      deviceType: props.deviceType,
      health: props.health || 'unknown',
    };
  });

  const edges = relationships.map(r => {
    let meta: any = {};
    try {
      meta = JSON.parse(r.metadata || '{}');
    } catch (error: unknown) { /* Intentionally ignored */ }

    return {
      source: r.source_id,
      target: r.target_id,
      type: r.type,
      label: meta.port ? `:${meta.port}` : '',
    };
  });

  // Add monitor → host edges
  for (const monitor of monitors) {
    // Find entity matching this monitor's target
    const targetEntity = entities.find(e => {
      try {
        const props = JSON.parse(e.properties || '{}');
        return props.ip === monitor.target || monitor.target.includes(props.ip || '');
      } catch {
        return false;
      }
    });

    if (targetEntity) {
      edges.push({
        source: monitor.id,
        target: targetEntity.id,
        type: 'monitors',
        label: monitor.type,
      });

      // Add monitor as a virtual node
      nodes.push({
        id: monitor.id,
        label: monitor.name,
        type: 'monitor',
        ip: '',
        vendor: '',
        deviceType: 'monitor',
        health: monitor.current_status,
      });
    }
  }

  // Generate SVG visualization
  const svg = generateNetworkSVG(nodes, edges);

  return new Response(JSON.stringify({
    success: true,
    svg,
    stats: {
      devices: nodes.filter(n => n.type === 'device').length,
      services: nodes.filter(n => n.type === 'service').length,
      monitors: nodes.filter(n => n.type === 'monitor').length,
      connections: edges.length,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * Generate animated SVG network topology diagram
 * Inspired by dashmotion's dashed connector + traveling dot technique
 */
function generateNetworkSVG(nodes: any[], edges: any[]): string {
  const width = 1200;
  const height = 800;
  const padding = 60;

  // Layout nodes in layers by type
  const layers: Record<string, any[]> = {};
  for (const node of nodes) {
    const layer = node.type;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(node);
  }

  const layerOrder = ['router', 'network', 'switch', 'host', 'device', 'container', 'service', 'monitor'];
  const activeLayers = layerOrder.filter(l => layers[l] && layers[l].length > 0);
  const layerHeight = (height - 2 * padding) / (activeLayers.length + 1);

  // Assign positions
  const positions = new Map<string, { x: number; y: number }>();

  activeLayers.forEach((layer, layerIndex) => {
    const layerNodes = layers[layer];
    const y = padding + (layerIndex + 1) * layerHeight;
    const nodeSpacing = (width - 2 * padding) / (layerNodes.length + 1);

    layerNodes.forEach((node, nodeIndex) => {
      const x = padding + (nodeIndex + 1) * nodeSpacing;
      positions.set(node.id, { x, y });
    });
  });

  // Color scheme
  const typeColors: Record<string, string> = {
    router: '#6366F1',
    network: '#8B5CF6',
    switch: '#A855F7',
    host: '#EC4899',
    device: '#F43F5E',
    container: '#F59E0B',
    service: '#10B981',
    monitor: '#06B6D4',
  };

  const healthColors: Record<string, string> = {
    healthy: '#22C55E',
    up: '#22C55E',
    degraded: '#EAB308',
    down: '#EF4444',
    unknown: '#6B7280',
  };

  // Build SVG
  let svgContent = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      @keyframes dash {
        to { stroke-dashoffset: -20; }
      }
      @keyframes travel {
        to { offset-distance: 100%; }
      }
      .connector {
        stroke-dasharray: 5 5;
        animation: dash 1s linear infinite;
      }
      .dot {
        animation: travel 3s linear infinite;
      }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="#0F172A"/>
`;

  // Draw edges (connections)
  for (const edge of edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);

    if (source && target) {
      // Curved path
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const controlX = midX;
      const controlY = midY - 50;

      const pathId = `path-${edge.source}-${edge.target}`;

      svgContent += `
  <path id="${pathId}" d="M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}"
        fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2" class="connector"/>
  <circle r="4" fill="#22C55E" opacity="0.8" class="dot">
    <animateMotion dur="3s" repeatCount="indefinite">
      <mpath href="#${pathId}"/>
    </animateMotion>
  </circle>`;

      // Edge label
      if (edge.label) {
        svgContent += `
  <text x="${midX}" y="${controlY - 10}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="middle">${edge.label}</text>`;
      }
    }
  }

  // Draw nodes
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;

    const color = typeColors[node.type] || '#6B7280';
    const healthColor = healthColors[node.health] || '#6B7280';

    svgContent += `
  <g transform="translate(${pos.x}, ${pos.y})">
    <circle r="20" fill="${color}" opacity="0.3" stroke="${healthColor}" stroke-width="2"/>
    <circle r="8" fill="${healthColor}"/>
    <text y="35" fill="rgba(255,255,255,0.9)" font-size="12" text-anchor="middle">${node.label}</text>
    ${node.ip ? `<text y="48" fill="rgba(255,255,255,0.5)" font-size="9" text-anchor="middle">${node.ip}</text>` : ''}
  </g>`;
  }

  svgContent += `
</svg>`;

  return svgContent;
}
