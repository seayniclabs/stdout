import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../../../lib/rbac';

// GET — return current status page config
export const GET: APIRoute = async ({ locals }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const db = getDb();
  const page = db.select().from(schema.statusPage)
    .where(eq(schema.statusPage.userId, locals.user.id)).get();

  return new Response(JSON.stringify({ page: page || null }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST — create or update status page config
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC gate
  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_monitors');
  if (rbacBlock) return rbacBlock;

  // Tier gate: public status pages
  const { checkFeature, tierBlockedResponse } = await import('../../../lib/tier-gate');
  const gate = checkFeature(locals.user, 'publicStatusPages');
  if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getDb();
  const existing = db.select().from(schema.statusPage)
    .where(eq(schema.statusPage.userId, locals.user.id)).get();

  // Validate slug
  let slug = (body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug || slug.length < 3) {
    return new Response(JSON.stringify({ error: 'Slug must be at least 3 characters (letters, numbers, hyphens)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const title = (body.title || 'Service Status').trim();
  const description = (body.description || '').trim() || null;
  const enabled = body.enabled !== false;
  const monitorIds = Array.isArray(body.monitorIds) ? body.monitorIds : [];
  const showResponseTime = body.showResponseTime !== false;
  const showUptime = body.showUptime !== false;

  const values = {
    slug,
    title,
    description,
    enabled,
    monitorIds: JSON.stringify(monitorIds),
    showResponseTime,
    showUptime,
    updatedAt: new Date(),
  };

  if (existing) {
    db.update(schema.statusPage).set(values)
      .where(and(
        eq(schema.statusPage.id, existing.id),
        eq(schema.statusPage.userId, locals.user.id),
      )).run();
  } else {
    db.insert(schema.statusPage).values({
      id: nanoid(), userId: locals.user.id, createdAt: new Date(), ...values,
    }).run();
  }

  return new Response(JSON.stringify({ updated: true, slug }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
