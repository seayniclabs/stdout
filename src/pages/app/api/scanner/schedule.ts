import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';

// GET — returns the user's scan schedule (used by scanner polling)
// Also accepts Bearer token auth so the scanner can poll this
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getDb();
  const schedule = db.select().from(schema.scannerSchedule)
    .where(eq(schema.scannerSchedule.userId, locals.user.id)).get();

  if (!schedule) {
    // Return defaults if no schedule configured yet
    return new Response(JSON.stringify({
      interval: 'daily',
      hour: 3,
      minute: 0,
      weekday: 0,
      enabled: true,
      modules: ['docker', 'metrics'],
      subnets: null,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  let modules: string[];
  try { modules = JSON.parse(schedule.modules); } catch { modules = ['docker', 'metrics']; }

  let subnets: string[] | null = null;
  if (schedule.subnets) {
    try { subnets = JSON.parse(schedule.subnets); } catch { subnets = null; }
  }

  return new Response(JSON.stringify({
    interval: schedule.interval,
    hour: schedule.hour,
    minute: schedule.minute,
    weekday: schedule.weekday,
    enabled: schedule.enabled,
    modules,
    subnets,
  }), { headers: { 'Content-Type': 'application/json' } });
};

// PUT — update the scan schedule (from settings UI)
export const PUT: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Validate
  const interval = body.interval || 'daily';
  if (!['hourly', 'daily', 'weekly'].includes(interval)) {
    return new Response(JSON.stringify({ error: 'Invalid interval. Use hourly, daily, or weekly.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const hour = Math.max(0, Math.min(23, parseInt(body.hour) || 3));
  const minute = Math.max(0, Math.min(59, parseInt(body.minute) || 0));
  const weekday = Math.max(0, Math.min(6, parseInt(body.weekday) || 0));
  const enabled = body.enabled !== false;

  const validModules = ['docker', 'metrics', 'network', 'dns', 'auth'];
  const modules = Array.isArray(body.modules)
    ? body.modules.filter((m: string) => validModules.includes(m))
    : ['docker', 'metrics'];

  const subnets = Array.isArray(body.subnets) && body.subnets.length > 0
    ? body.subnets
    : null;

  const db = getDb();
  const existing = db.select().from(schema.scannerSchedule)
    .where(eq(schema.scannerSchedule.userId, locals.user.id)).get();

  const values = {
    interval,
    hour,
    minute,
    weekday,
    enabled,
    modules: JSON.stringify(modules),
    subnets: subnets ? JSON.stringify(subnets) : null,
    updatedAt: new Date(),
  };

  if (existing) {
    db.update(schema.scannerSchedule).set(values)
      .where(and(
        eq(schema.scannerSchedule.id, existing.id),
        eq(schema.scannerSchedule.userId, locals.user.id),
      )).run();
  } else {
    db.insert(schema.scannerSchedule).values({
      id: nanoid(), userId: locals.user.id, ...values,
    }).run();
  }

  return new Response(JSON.stringify({ updated: true }), { headers: { 'Content-Type': 'application/json' } });
};
