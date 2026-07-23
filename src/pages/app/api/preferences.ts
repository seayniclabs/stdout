import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../../../lib/rbac';

// --- Branding ---

export const GET: APIRoute = async ({ locals }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const db = getDb();

  const branding = db.select().from(schema.tenantPreferences)
    .where(eq(schema.tenantPreferences.userId, locals.user.id)).get();

  const notifications = db.select().from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, locals.user.id)).all();

  return new Response(JSON.stringify({ branding: branding || null, notifications }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

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
  const action = body.action;

  // --- Branding ---
  if (action === 'update_branding') {
    const existing = db.select().from(schema.tenantPreferences)
      .where(eq(schema.tenantPreferences.userId, locals.user.id)).get();

    const values = {
      workspaceName: (body.workspaceName || '').trim() || null,
      accentColor: (body.accentColor || '').trim() || null,
      logoUrl: (body.logoUrl || '').trim() || null,
      updatedAt: new Date(),
    };

    if (existing) {
      db.update(schema.tenantPreferences).set(values)
        .where(and(
          eq(schema.tenantPreferences.id, existing.id),
          eq(schema.tenantPreferences.userId, locals.user.id),
        )).run();
    } else {
      db.insert(schema.tenantPreferences).values({
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
    db.insert(schema.notificationPreferences).values({
      id, userId: locals.user.id, channel, destination,
      events: JSON.stringify(events), enabled: true, createdAt: now, updatedAt: now,
    }).run();

    return new Response(JSON.stringify({ id }), { headers: { 'Content-Type': 'application/json' } });
  }

  // --- Toggle notification ---
  if (action === 'toggle_notification') {
    const notifId = body.id;
    const enabled = body.enabled;
    db.update(schema.notificationPreferences)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(schema.notificationPreferences.id, notifId), eq(schema.notificationPreferences.userId, locals.user.id)))
      .run();
    return new Response(JSON.stringify({ toggled: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  // --- Delete notification ---
  if (action === 'delete_notification') {
    const notifId = body.id;
    db.delete(schema.notificationPreferences)
      .where(and(eq(schema.notificationPreferences.id, notifId), eq(schema.notificationPreferences.userId, locals.user.id)))
      .run();
    return new Response(JSON.stringify({ deleted: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
};

// PUT /app/api/preferences — update individual preference fields
export const PUT: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

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
  const existing = db.select().from(schema.tenantPreferences)
    .where(eq(schema.tenantPreferences.userId, locals.user.id)).get();

  const updates: any = { updatedAt: new Date() };

  if (body.addonsHidden !== undefined) {
    updates.addonsHidden = !!body.addonsHidden;
  }
  if (body.addonsDismissed !== undefined) {
    updates.addonsDismissed = !!body.addonsDismissed;
  }

  if (existing) {
    db.update(schema.tenantPreferences).set(updates)
      .where(and(
        eq(schema.tenantPreferences.id, existing.id),
        eq(schema.tenantPreferences.userId, locals.user.id),
      )).run();
  } else {
    db.insert(schema.tenantPreferences).values({
      id: nanoid(), userId: locals.user.id, ...updates,
    }).run();
  }

  return new Response(JSON.stringify({ updated: true }), { headers: { 'Content-Type': 'application/json' } });
};
