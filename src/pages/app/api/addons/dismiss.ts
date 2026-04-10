import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';

// POST /app/api/addons/dismiss — dismiss the add-ons banner for this session
export const POST: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);

  db.update(tenantSchema.tenantPreferences)
    .set({ addonsDismissed: true })
    .where(eq(tenantSchema.tenantPreferences.userId, userId))
    .run();

  return Response.json({ ok: true });
};
