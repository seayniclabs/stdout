import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { checkCountLimit, tierBlockedResponse } from '../../../../lib/tier-gate';
import { checkRBAC } from '../../../../lib/rbac';

const MAX_PAYLOAD_BYTES = 1_048_576; // 1MB

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  // Tier gate: stack count
  const db = getTenantDb(locals.user.id);
  const stackCount = db.select().from(tenantSchema.stacks).where(eq(tenantSchema.stacks.userId, locals.user.id)).all().length;
  const gate = checkCountLimit(locals.user, 'maxStacks', stackCount, 'Stack');
  if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

  // Check payload size
  const contentLength = parseInt(request.headers.get('content-length') || '0');
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return new Response(JSON.stringify({ error: 'Payload too large (max 1MB)' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.version || !body.containers || !Array.isArray(body.containers)) {
    return new Response(JSON.stringify({ error: 'Invalid scan format. Required: version, containers[]' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Render markdown from scan data
  const markdown = renderMarkdown(body);

  const importId = nanoid();

  db.insert(tenantSchema.stackImports).values({
    id: importId,
    rawJson: JSON.stringify(body),
    renderedMarkdown: markdown,
    status: 'pending',
    createdAt: new Date(),
  }).run();

  return new Response(JSON.stringify({
    importId,
    reviewUrl: `/app/stacks/import/${importId}`,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

function renderMarkdown(scan: any): string {
  const lines: string[] = [
    '# Infrastructure Stack',
    `Scanned: ${scan.scanned_at || new Date().toISOString()}`,
    '',
  ];

  if (scan.host) {
    lines.push('## Host');
    if (scan.host.os) lines.push(`- OS: ${scan.host.os} (${scan.host.arch || 'unknown'})`);
    if (scan.host.cpu_cores) lines.push(`- CPU: ${scan.host.cpu_cores} cores`);
    if (scan.host.memory_gb) lines.push(`- RAM: ${scan.host.memory_gb} GB`);
    if (scan.host.disk?.length) {
      for (const d of scan.host.disk) {
        lines.push(`- Disk ${d.mount}: ${d.used_gb}/${d.total_gb} GB used`);
      }
    }
    lines.push('');
  }

  const running = scan.containers.filter((c: any) => c.status === 'running');
  lines.push(`## Containers (${running.length} running)`);
  lines.push('');

  for (const c of scan.containers) {
    lines.push(`### ${c.name} (${c.image || 'unknown'})`);
    if (c.ports?.length) {
      const portStr = c.ports.map((p: any) => `${p.host}:${p.container}`).join(', ');
      lines.push(`- Ports: ${portStr}`);
    }
    if (c.networks?.length) lines.push(`- Networks: ${c.networks.join(', ')}`);
    if (c.health) lines.push(`- Health: ${c.health}`);
    if (c.status) lines.push(`- Status: ${c.status}`);
    lines.push('');
  }

  return lines.join('\n');
}
