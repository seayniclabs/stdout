import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { sendWindlassWeeklyDigest } from '../../../../lib/alert-router';

function computeRecoveredGbHours(userId: string): { recoveredGbHours: number; serviceCount: number } {
  const db = getTenantDb(userId);
  const services = db.select().from(tenantSchema.windlassServices)
    .where(eq(tenantSchema.windlassServices.userId, userId))
    .all();

  let recoveredGbHours = 0;
  for (const service of services) {
    if (!service.memoryMb || !service.usageAnalytics) continue;
    try {
      const analytics = JSON.parse(service.usageAnalytics);
      const idleMinutes = analytics?.idle_minutes_total || 0;
      recoveredGbHours += (service.memoryMb / 1024) * (idleMinutes / 60);
    } catch {
      // ignore malformed analytics blob
    }
  }
  return { recoveredGbHours, serviceCount: services.length };
}

/**
 * POST /app/api/windlass/weekly-digest
 * Manually trigger the weekly savings digest (same GB-hours model as automatic Sunday send).
 * When WINDLASS_WEEKLY_DIGEST_SECRET is set, require header X-Windlass-Digest-Secret matching it (cron / operator).
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const secret = process.env.WINDLASS_WEEKLY_DIGEST_SECRET;
  if (secret) {
    const hdr = request.headers.get('x-windlass-digest-secret');
    if (hdr !== secret) {
      return new Response(JSON.stringify({ error: 'Invalid digest secret' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);

  let body: { force?: boolean } = {};
  try {
    if (request.headers.get('Content-Type')?.includes('application/json')) {
      body = await request.json();
    }
  } catch {
    body = {};
  }

  const { recoveredGbHours, serviceCount } = computeRecoveredGbHours(userId);

  if (recoveredGbHours <= 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'No usage analytics with idle time — sync Windlass first.',
    }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.force) {
    const cfg = db.select().from(tenantSchema.windlassConfig)
      .where(eq(tenantSchema.windlassConfig.userId, userId))
      .get();
    const last = cfg?.lastWeeklyDigestAt ? new Date(cfg.lastWeeklyDigestAt).getTime() : 0;
    if (last && Date.now() - last < 6 * 24 * 60 * 60 * 1000) {
      return new Response(JSON.stringify({
        ok: false,
        skipped: 'weekly_digest_cooldown',
        message: 'Digest sent within the last 6 days. Pass {"force":true} to override.',
      }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const now = new Date();
  const weekLabel = now.toISOString().slice(0, 10);

  const result = await sendWindlassWeeklyDigest(userId, {
    recoveredGbHours,
    serviceCount,
    weekLabel,
  }, { skipCooldown: true });

  if (!result.sent) {
    return new Response(JSON.stringify({
      ok: false,
      skipped: result.skipped || 'not_sent',
    }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }

  db.update(tenantSchema.windlassConfig)
    .set({ lastWeeklyDigestAt: now, updatedAt: now })
    .where(eq(tenantSchema.windlassConfig.userId, userId))
    .run();

  return new Response(JSON.stringify({
    ok: true,
    summary: {
      recoveredGbHours,
      serviceCount,
      weekLabel,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
