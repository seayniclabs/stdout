import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';

// POST /app/api/addons/notify — register interest in a Coming Soon item
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { productName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { productName } = body;
  if (!productName || typeof productName !== 'string' || productName.length > 200) {
    return Response.json({ error: 'invalid_product_name' }, { status: 400 });
  }

  const db = getDb();
  const userEmail = locals.user.email;

  // Check for existing interest (no duplicates)
  const existing = db.select()
    .from(schema.addonInterest)
    .where(
      and(
        eq(schema.addonInterest.productName, productName),
        eq(schema.addonInterest.email, userEmail),
      )
    )
    .get();

  if (existing) {
    return Response.json({ ok: true, alreadyRegistered: true });
  }

  db.insert(schema.addonInterest).values({
    id: `interest-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    email: userEmail,
    productName,
    createdAt: new Date(),
  }).run();

  return Response.json({ ok: true });
};
