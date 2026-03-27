import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '../../../lib/crypto';
import { testConnection } from '../../../lib/influx';
import { isBlockedTarget } from '../../../lib/hud';

// --- List data sources ---

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getTenantDb(locals.workspace?.ownerId || locals.user.id);
  const sources = db.select().from(tenantSchema.dataSources)
    .where(eq(tenantSchema.dataSources.userId, locals.user.id))
    .all();

  // Strip encrypted tokens — return masked version
  const safe = sources.map(s => ({
    ...s,
    token: s.token ? '********' : null,
    hasToken: !!s.token,
  }));

  return new Response(JSON.stringify({ sources: safe }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// --- Create / Update / Delete / Test ---

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getTenantDb(locals.workspace?.ownerId || locals.user.id);
  const action = body.action;

  // --- Create ---
  if (action === 'create') {
    const name = (body.name || '').trim();
    const type = body.type;
    const url = (body.url || '').trim();
    const org = (body.org || '').trim();
    const bucket = (body.bucket || '').trim();
    const token = (body.token || '').trim();

    if (!name || !type || !url) {
      return new Response(JSON.stringify({ error: 'Name, type, and URL are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // SSRF protection — block internal/private network URLs
    if (isBlockedTarget(url)) {
      return new Response(JSON.stringify({ error: 'URL points to a private or internal address' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!['influxdb', 'prometheus'].includes(type)) {
      return new Response(JSON.stringify({ error: 'Invalid type' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const id = nanoid();
    const now = new Date();

    db.insert(tenantSchema.dataSources).values({
      id,
      userId: locals.user.id,
      name,
      type,
      url,
      token: token ? encrypt(token) : null,
      org: org || null,
      bucket: bucket || null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).run();

    return new Response(JSON.stringify({ id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Update ---
  if (action === 'update') {
    const dsId = body.id;
    if (!dsId) {
      return new Response(JSON.stringify({ error: 'ID required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const existing = db.select().from(tenantSchema.dataSources)
      .where(and(
        eq(tenantSchema.dataSources.id, dsId),
        eq(tenantSchema.dataSources.userId, locals.user.id),
      )).get();

    if (!existing) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const updates: any = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = (body.name || '').trim();
    if (body.url !== undefined) {
      const newUrl = (body.url || '').trim();
      // SSRF protection on update path
      const { isBlockedTarget: isBlockedUrl } = await import('../../../lib/hud');
      if (newUrl && isBlockedUrl(newUrl)) {
        return new Response(JSON.stringify({ error: 'URL points to a private or internal address' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      updates.url = newUrl;
    }
    if (body.org !== undefined) updates.org = (body.org || '').trim() || null;
    if (body.bucket !== undefined) updates.bucket = (body.bucket || '').trim() || null;
    if (body.enabled !== undefined) updates.enabled = !!body.enabled;
    // Only update token if explicitly provided (not masked)
    if (body.token !== undefined && body.token !== '********') {
      updates.token = body.token ? encrypt(body.token) : null;
    }

    db.update(tenantSchema.dataSources).set(updates)
      .where(eq(tenantSchema.dataSources.id, dsId)).run();

    return new Response(JSON.stringify({ updated: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Delete ---
  if (action === 'delete') {
    const dsId = body.id;
    db.delete(tenantSchema.dataSources)
      .where(and(
        eq(tenantSchema.dataSources.id, dsId),
        eq(tenantSchema.dataSources.userId, locals.user.id),
      )).run();

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Test Connection ---
  if (action === 'test') {
    const url = (body.url || '').trim();
    const token = (body.token || '').trim();
    const org = (body.org || '').trim();
    const bucket = (body.bucket || '').trim();

    // If token is masked, retrieve the stored one
    let resolvedToken = token;
    if (token === '********' && body.id) {
      const existing = db.select().from(tenantSchema.dataSources)
        .where(and(
          eq(tenantSchema.dataSources.id, body.id),
          eq(tenantSchema.dataSources.userId, locals.user.id),
        )).get();
      if (existing?.token) {
        resolvedToken = decrypt(existing.token) || '';
      }
    }

    if (!url) {
      return new Response(JSON.stringify({ ok: false, error: 'URL required' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // SSRF protection on test connection
    if (isBlockedTarget(url)) {
      return new Response(JSON.stringify({ ok: false, error: 'URL points to a private or internal address' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await testConnection({
      url,
      token: resolvedToken,
      org,
      bucket,
    });

    // Update last test status if we have an ID
    if (body.id) {
      db.update(tenantSchema.dataSources).set({
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? 'ok' : (result.error || 'error'),
        updatedAt: new Date(),
      }).where(and(
        eq(tenantSchema.dataSources.id, body.id),
        eq(tenantSchema.dataSources.userId, locals.user.id),
      )).run();
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
