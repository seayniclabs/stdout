import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../lib/db';
import { eq } from 'drizzle-orm';

// GET — return current status page config
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getTenantDb(locals.user.id);
  const page = db.select().from(tenantSchema.statusPage)
    .where(eq(tenantSchema.statusPage.userId, locals.user.id)).get();

  return new Response(JSON.stringify({ page: page || null }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST — create or update status page config
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  // Tier gate: public status pages
  const { checkFeature, tierBlockedResponse } = await import('../../../lib/tier-gate');
  const gate = checkFeature(locals.user, 'publicStatusPages');
  if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getTenantDb(locals.user.id);
  const existing = db.select().from(tenantSchema.statusPage)
    .where(eq(tenantSchema.statusPage.userId, locals.user.id)).get();

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
    db.update(tenantSchema.statusPage).set(values)
      .where(eq(tenantSchema.statusPage.id, existing.id)).run();
  } else {
    db.insert(tenantSchema.statusPage).values({
      id: nanoid(), userId: locals.user.id, createdAt: new Date(), ...values,
    }).run();
  }

  return new Response(JSON.stringify({ updated: true, slug }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
