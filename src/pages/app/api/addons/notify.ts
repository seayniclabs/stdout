import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../../../../lib/rbac';

// POST /app/api/addons/notify — register interest in a Coming Soon item
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  let body: { productName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || (body as any)._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return Response.json({ error: 'CSRF token validation failed' }, { status: 403 });
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
