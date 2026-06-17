import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';

// POST /app/api/addons/dismiss — dismiss the add-ons banner for this session
export const POST: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();

  db.update(schema.tenantPreferences)
    .set({ addonsDismissed: true })
    .where(eq(schema.tenantPreferences.userId, userId))
    .run();

  return Response.json({ ok: true });
};
