import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { startMonitor, stopMonitor, getRecentChecks, getUptimeStats } from '../../../lib/hud';

// GET — list all monitors with current status + sparkline data
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getTenantDb(locals.user.id);
  const monitorId = url.searchParams.get('id');

  if (monitorId) {
    // Single monitor detail with check history
    const monitor = db.select().from(tenantSchema.monitors)
      .where(and(eq(tenantSchema.monitors.id, monitorId), eq(tenantSchema.monitors.userId, locals.user.id))).get();

    if (!monitor) {
      return new Response(JSON.stringify({ error: 'Monitor not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const recentChecks = getRecentChecks(locals.user.id, monitorId, 120);
    const uptime = getUptimeStats(locals.user.id, monitorId, 90);

    return new Response(JSON.stringify({ monitor, recentChecks, uptime }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // List all monitors with sparkline data
  const allMonitors = db.select().from(tenantSchema.monitors)
    .where(eq(tenantSchema.monitors.userId, locals.user.id))
    .orderBy(desc(tenantSchema.monitors.createdAt))
    .all();

  const monitorsWithData = allMonitors.map(m => {
    const sparkline = getRecentChecks(locals.user.id, m.id, 30)
      .map(c => ({ ms: c.responseTimeMs, status: c.status }));
    const uptime = getUptimeStats(locals.user.id, m.id, 30);
    return { ...m, sparkline, uptimePercent: uptime.uptimePercent, avgResponse: uptime.avgResponse };
  });

  return new Response(JSON.stringify({ monitors: monitorsWithData }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST — create or update a monitor
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const action = body.action || 'create';
  const db = getTenantDb(locals.user.id);

  if (action === 'create') {
    const name = (body.name || '').trim();
    const type = body.type;
    const target = (body.target || '').trim();

    if (!name || !type || !target) {
      return new Response(JSON.stringify({ error: 'Name, type, and target are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!['http', 'tcp'].includes(type)) {
      return new Response(JSON.stringify({ error: 'Type must be http or tcp (more coming soon)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const id = nanoid();
    const now = new Date();
    const intervalSeconds = Math.max(30, Math.min(3600, parseInt(body.interval) || 60));
    const timeoutMs = Math.max(1000, Math.min(30000, parseInt(body.timeout) || 5000));

    db.insert(tenantSchema.monitors).values({
      id,
      userId: locals.user.id,
      name,
      type,
      target,
      intervalSeconds,
      timeoutMs,
      expectedStatus: type === 'http' ? (parseInt(body.expectedStatus) || 200) : null,
      retries: Math.max(1, Math.min(10, parseInt(body.retries) || 3)),
      stackId: body.stackId || null,
      paused: false,
      maintenance: false,
      currentStatus: 'unknown',
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Start checking
    startMonitor(locals.user.id, id);

    return new Response(JSON.stringify({ id, name }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'update') {
    const id = body.id;
    if (!id) return new Response(JSON.stringify({ error: 'Monitor ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.target !== undefined) updates.target = body.target.trim();
    if (body.interval !== undefined) updates.intervalSeconds = Math.max(30, Math.min(3600, parseInt(body.interval) || 60));
    if (body.timeout !== undefined) updates.timeoutMs = Math.max(1000, Math.min(30000, parseInt(body.timeout) || 5000));
    if (body.expectedStatus !== undefined) updates.expectedStatus = parseInt(body.expectedStatus) || 200;
    if (body.retries !== undefined) updates.retries = Math.max(1, Math.min(10, parseInt(body.retries) || 3));
    if (body.paused !== undefined) updates.paused = body.paused;
    if (body.maintenance !== undefined) {
      updates.maintenance = body.maintenance;
      if (body.maintenance) updates.currentStatus = 'maintenance';
    }

    db.update(tenantSchema.monitors).set(updates)
      .where(and(eq(tenantSchema.monitors.id, id), eq(tenantSchema.monitors.userId, locals.user.id))).run();

    // Restart check loop with new settings
    if (body.paused) {
      stopMonitor(id);
    } else {
      startMonitor(locals.user.id, id);
    }

    return new Response(JSON.stringify({ updated: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'delete') {
    const id = body.id;
    if (!id) return new Response(JSON.stringify({ error: 'Monitor ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    stopMonitor(id);

    // Delete check results first (no FK cascade in SQLite without pragma)
    db.delete(tenantSchema.checkResults)
      .where(eq(tenantSchema.checkResults.monitorId, id)).run();
    db.delete(tenantSchema.uptimeDaily)
      .where(eq(tenantSchema.uptimeDaily.monitorId, id)).run();
    db.delete(tenantSchema.monitors)
      .where(and(eq(tenantSchema.monitors.id, id), eq(tenantSchema.monitors.userId, locals.user.id))).run();

    return new Response(JSON.stringify({ deleted: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
};
