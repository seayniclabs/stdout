import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';

// POST /app/api/addons/notify — register interest in a Coming Soon item
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { toolId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { toolId } = body;
  if (!toolId || typeof toolId !== 'string' || toolId.length > 100) {
    return Response.json({ error: 'invalid_tool_id' }, { status: 400 });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);

  // Check for existing interest (no duplicates)
  const existing = db.select()
    .from(tenantSchema.addonInterest)
    .where(
      and(
        eq(tenantSchema.addonInterest.toolId, toolId),
        eq(tenantSchema.addonInterest.userId, locals.user.id),
      )
    )
    .get();

  if (existing) {
    return Response.json({ ok: true, alreadyRegistered: true });
  }

  db.insert(tenantSchema.addonInterest).values({
    toolId,
    userId: locals.user.id,
    createdAt: new Date(),
  }).run();

  return Response.json({ ok: true });
};
