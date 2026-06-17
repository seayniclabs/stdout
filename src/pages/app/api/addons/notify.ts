import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
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
  const db = getDb();

  // Check for existing interest (no duplicates)
  const existing = db.select()
    .from(schema.addonInterest)
    .where(
      and(
        eq(schema.addonInterest.toolId, toolId),
        eq(schema.addonInterest.userId, locals.user.id),
      )
    )
    .get();

  if (existing) {
    return Response.json({ ok: true, alreadyRegistered: true });
  }

  db.insert(schema.addonInterest).values({
    toolId,
    userId: locals.user.id,
    createdAt: new Date(),
  }).run();

  return Response.json({ ok: true });
};
