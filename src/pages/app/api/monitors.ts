import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { startMonitor, stopMonitor, getRecentChecks, getUptimeStats } from '../../../lib/hud';

// GET — list all monitors with current status + sparkline data
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getDb();
  const monitorId = url.searchParams.get('id');

  if (monitorId) {
    // Single monitor detail with check history
    const monitor = db.select().from(schema.monitors)
      .where(and(eq(schema.monitors.id, monitorId), eq(schema.monitors.userId, locals.user.id))).get();

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
  const uid = locals.user.id;
  const allMonitors = db.select().from(schema.monitors)
    .where(eq(schema.monitors.userId, uid))
    .orderBy(desc(schema.monitors.createdAt))
    .all();

  const monitorsWithData = allMonitors.map(m => {
    const sparkline = getRecentChecks(uid, m.id, 30)
      .map(c => ({ ms: c.responseTimeMs, status: c.status }));
    const uptime = getUptimeStats(uid, m.id, 30);
    return { ...m, sparkline, uptimePercent: uptime.uptimePercent, avgResponse: uptime.avgResponse };
  });

  return new Response(JSON.stringify({ monitors: monitorsWithData }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST — create or update a monitor
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_monitors');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const action = body.action || 'create';
  const db = getDb();

  if (action === 'create') {
    // Tier gate: monitor count
    const { checkCountLimit, tierBlockedResponse } = await import('../../../lib/tier-gate');
    const existingCount = db.select().from(schema.monitors).where(eq(schema.monitors.userId, locals.user.id)).all().length;
    const gate = checkCountLimit(locals.user, 'maxMonitors', existingCount, 'Monitor');
    if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

    const name = (body.name || '').trim();
    const type = body.type;
    const target = (body.target || '').trim();

    if (!name || !type || !target) {
      return new Response(JSON.stringify({ error: 'Name, type, and target are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!['http', 'tcp', 'ping', 'output-freshness'].includes(type)) {
      return new Response(JSON.stringify({ error: 'Type must be http, tcp, ping, or output-freshness' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Validate target format
    if (type === 'http' && !target.startsWith('http://') && !target.startsWith('https://')) {
      return new Response(JSON.stringify({ error: 'HTTP monitor target must start with http:// or https://' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // SSRF protection — block private/internal network targets
    const { isBlockedTarget } = await import('../../../lib/hud');
    const targetUrl = type === 'http' ? target : `tcp://${target}`;
    if (isBlockedTarget(targetUrl)) {
      return new Response(JSON.stringify({ error: 'Target points to a private or internal address' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const id = nanoid();
    const now = new Date();
    const intervalSeconds = Math.max(30, Math.min(3600, parseInt(body.interval) || 60));
    const timeoutMs = Math.max(1000, Math.min(30000, parseInt(body.timeout) || 5000));

    db.insert(schema.monitors).values({
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
      jsonPath: body.jsonPath || null,
      freshnessWindowSeconds: body.freshnessWindowSeconds ? parseInt(body.freshnessWindowSeconds) : null,
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

    db.update(schema.monitors).set(updates)
      .where(and(eq(schema.monitors.id, id), eq(schema.monitors.userId, locals.user.id))).run();

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

    const owned = db.select().from(schema.monitors)
      .where(and(eq(schema.monitors.id, id), eq(schema.monitors.userId, locals.user.id)))
      .get();
    if (!owned) {
      return new Response(JSON.stringify({ error: 'Monitor not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    stopMonitor(id);

    // Delete check results first (no FK cascade in SQLite without pragma)
    db.delete(schema.checkResults)
      .where(eq(schema.checkResults.monitorId, id)).run();
    db.delete(schema.uptimeDaily)
      .where(eq(schema.uptimeDaily.monitorId, id)).run();
    db.delete(schema.monitors)
      .where(and(eq(schema.monitors.id, id), eq(schema.monitors.userId, locals.user.id))).run();

    return new Response(JSON.stringify({ deleted: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
};
