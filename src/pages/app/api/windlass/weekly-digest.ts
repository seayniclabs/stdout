import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq, isNotNull, and } from 'drizzle-orm';
import { sendWindlassWeeklyDigest } from '../../../../lib/alert-router';

export const POST: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);
  const services = db.select().from(tenantSchema.windlassServices)
    .where(and(
      eq(tenantSchema.windlassServices.userId, userId),
      isNotNull(tenantSchema.windlassServices.schedulingSuggestion),
    ))
    .all();

  const recoveredGbHours = services.reduce((sum, service) => {
    if (!service.memoryMb || !service.idleHoursPerDay) return sum;
    return sum + ((service.idleHoursPerDay * service.memoryMb) / 1024);
  }, 0);

  await sendWindlassWeeklyDigest(userId, {
    recoveredGbHours,
    serviceCount: services.length,
    weekLabel: new Date().toISOString().slice(0, 10),
  });

  db.update(tenantSchema.windlassConfig)
    .set({ lastWeeklyDigestAt: new Date(), updatedAt: new Date() })
    .where(eq(tenantSchema.windlassConfig.userId, userId))
    .run();

  return new Response(JSON.stringify({
    ok: true,
    summary: {
      recoveredGbHours,
      serviceCount: services.length,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
