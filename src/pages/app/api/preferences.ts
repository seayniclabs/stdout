import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../lib/db';
import { eq, and } from 'drizzle-orm';

// --- Branding ---

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getTenantDb(locals.workspace?.ownerId || locals.user!.id);

  const branding = db.select().from(tenantSchema.tenantPreferences)
    .where(eq(tenantSchema.tenantPreferences.userId, locals.user.id)).get();

  const notifications = db.select().from(tenantSchema.notificationPreferences)
    .where(eq(tenantSchema.notificationPreferences.userId, locals.user.id)).all();

  return new Response(JSON.stringify({ branding: branding || null, notifications }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getTenantDb(locals.workspace?.ownerId || locals.user!.id);
  const action = body.action;

  // --- Branding ---
  if (action === 'update_branding') {
    const existing = db.select().from(tenantSchema.tenantPreferences)
      .where(eq(tenantSchema.tenantPreferences.userId, locals.user.id)).get();

    const values = {
      workspaceName: (body.workspaceName || '').trim() || null,
      accentColor: (body.accentColor || '').trim() || null,
      logoUrl: (body.logoUrl || '').trim() || null,
      updatedAt: new Date(),
    };

    if (existing) {
      db.update(tenantSchema.tenantPreferences).set(values)
        .where(eq(tenantSchema.tenantPreferences.id, existing.id)).run();
    } else {
      db.insert(tenantSchema.tenantPreferences).values({
        id: nanoid(), userId: locals.user.id, ...values,
      }).run();
    }

    return new Response(JSON.stringify({ updated: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  // --- Add notification ---
  if (action === 'add_notification') {
    const channel = body.channel;
    const destination = (body.destination || '').trim();
    const events = body.events || ['incident_created'];

    if (!['email', 'webhook'].includes(channel)) {
      return new Response(JSON.stringify({ error: 'Invalid channel' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!destination) {
      return new Response(JSON.stringify({ error: 'Destination required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const id = nanoid();
    const now = new Date();
    db.insert(tenantSchema.notificationPreferences).values({
      id, userId: locals.user.id, channel, destination,
      events: JSON.stringify(events), enabled: true, createdAt: now, updatedAt: now,
    }).run();

    return new Response(JSON.stringify({ id }), { headers: { 'Content-Type': 'application/json' } });
  }

  // --- Toggle notification ---
  if (action === 'toggle_notification') {
    const notifId = body.id;
    const enabled = body.enabled;
    db.update(tenantSchema.notificationPreferences)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(tenantSchema.notificationPreferences.id, notifId), eq(tenantSchema.notificationPreferences.userId, locals.user.id)))
      .run();
    return new Response(JSON.stringify({ toggled: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  // --- Delete notification ---
  if (action === 'delete_notification') {
    const notifId = body.id;
    db.delete(tenantSchema.notificationPreferences)
      .where(and(eq(tenantSchema.notificationPreferences.id, notifId), eq(tenantSchema.notificationPreferences.userId, locals.user.id)))
      .run();
    return new Response(JSON.stringify({ deleted: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
};
