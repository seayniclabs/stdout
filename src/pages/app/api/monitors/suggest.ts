import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { startMonitor } from '../../../../lib/hud';

// GET — suggest monitors from the most recent confirmed scanner import
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getTenantDb(locals.user.id);

  // Find most recent confirmed import
  const lastImport = db.select().from(tenantSchema.stackImports)
    .where(eq(tenantSchema.stackImports.status, 'confirmed'))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (!lastImport) {
    return new Response(JSON.stringify({ suggestions: [] }), { headers: { 'Content-Type': 'application/json' } });
  }

  let scanData: any;
  try { scanData = JSON.parse(lastImport.rawJson); } catch {
    return new Response(JSON.stringify({ suggestions: [] }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Get existing monitors to avoid duplicates
  const existingMonitors = db.select().from(tenantSchema.monitors)
    .where(eq(tenantSchema.monitors.userId, locals.user.id)).all();
  const existingTargets = new Set(existingMonitors.map(m => m.target.toLowerCase()));

  const suggestions: any[] = [];

  // Suggest monitors for containers with exposed ports
  for (const container of (scanData.containers || [])) {
    if (container.status !== 'running') continue;

    for (const port of (container.ports || [])) {
      if (!port.host || port.host === 0) continue;

      // Determine check type and target
      const isHTTPS = [443, 8443, 9443].includes(port.host);
      const isHTTP = [80, 8080, 8888, 3000, 5000, 5678, 8100, 8101, 8102, 8103, 8104, 8105, 8106, 8107, 8108, 8109, 8110, 8111, 8112, 8113, 9090, 9925, 19999, 32400].includes(port.host);

      let type = 'tcp';
      let target = `host.docker.internal:${port.host}`;

      if (isHTTPS) {
        type = 'http';
        target = `https://host.docker.internal:${port.host}`;
      } else if (isHTTP) {
        type = 'http';
        target = `http://host.docker.internal:${port.host}`;
      }

      // Skip if already monitored
      if (existingTargets.has(target.toLowerCase())) continue;

      suggestions.push({
        name: container.name,
        type,
        target,
        composeProject: container.compose_project || null,
        image: container.image,
      });
    }
  }

  return new Response(JSON.stringify({ suggestions }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST — bulk-create monitors from suggestions
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const monitors = body.monitors;
  if (!Array.isArray(monitors) || monitors.length === 0) {
    return new Response(JSON.stringify({ error: 'No monitors provided' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getTenantDb(locals.user.id);
  const now = new Date();
  const created: string[] = [];

  for (const m of monitors) {
    const id = nanoid();
    db.insert(tenantSchema.monitors).values({
      id,
      userId: locals.user.id,
      name: m.name,
      type: m.type || 'http',
      target: m.target,
      intervalSeconds: 60,
      timeoutMs: 5000,
      expectedStatus: m.type === 'http' ? 200 : null,
      retries: 3,
      stackId: m.stackId || null,
      paused: false,
      maintenance: false,
      currentStatus: 'unknown',
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    }).run();

    startMonitor(locals.user.id, id);
    created.push(id);
  }

  return new Response(JSON.stringify({ created: created.length }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
