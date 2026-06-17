import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '../../../lib/crypto';
import { testConnection as testInfluxConnection } from '../../../lib/influx';
import { testPrometheusConnection } from '../../../lib/prometheus';
import { testSourceConnection } from '../../../lib/source-test';
import { isBlockedTarget } from '../../../lib/hud';
import { checkRBAC, getWorkspaceOwnerId } from '../../../lib/rbac';

const VALID_DS_TYPES = ['influxdb', 'prometheus', 'trivy', 'uptime-kuma', 'loki', 'graylog', 'crowdsec', 'pihole'] as const;

function canMutateDataSource(locals: App.Locals, rowUserId: string): boolean {
  if (rowUserId === locals.user!.id) return true;
  const ownerId = getWorkspaceOwnerId(locals);
  if (rowUserId === ownerId && checkRBAC(locals, 'manage_settings') === null) return true;
  return false;
}

// --- List data sources ---

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getDb();
  // Tenant DB is already workspace-scoped — list all rows so team members see shared integrations.
  const sources = db.select().from(schema.dataSources).all();

  // Strip encrypted tokens/passwords — return masked version
  const safe = sources.map(s => ({
    ...s,
    token: s.token ? '********' : null,
    hasToken: !!s.token,
    password: s.password ? '********' : null,
    hasPassword: !!s.password,
  }));

  return new Response(JSON.stringify({ sources: safe }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// --- Create / Update / Delete / Test ---

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
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

    if (!(VALID_DS_TYPES as readonly string[]).includes(type)) {
      return new Response(JSON.stringify({ error: 'Invalid type' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const username = (body.username || '').trim();
    const password = (body.password || '').trim();

    const id = nanoid();
    const now = new Date();

    db.insert(schema.dataSources).values({
      id,
      userId: locals.user.id,
      name,
      type,
      url,
      token: token ? encrypt(token) : null,
      username: username || null,
      password: password ? encrypt(password) : null,
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

    const existing = db.select().from(schema.dataSources)
      .where(eq(schema.dataSources.id, dsId))
      .get();

    if (!existing || !canMutateDataSource(locals, existing.userId)) {
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
    if (body.username !== undefined) updates.username = (body.username || '').trim() || null;
    if (body.password !== undefined && body.password !== '********') {
      updates.password = body.password ? encrypt(body.password) : null;
    }

    db.update(schema.dataSources).set(updates)
      .where(and(
        eq(schema.dataSources.id, dsId),
        eq(schema.dataSources.userId, locals.user.id),
      )).run();

    return new Response(JSON.stringify({ updated: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Delete ---
  if (action === 'delete') {
    const dsId = body.id;
    const row = db.select().from(schema.dataSources)
      .where(eq(schema.dataSources.id, dsId))
      .get();
    if (!row || !canMutateDataSource(locals, row.userId)) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    db.delete(schema.dataSources)
      .where(and(
        eq(schema.dataSources.id, dsId),
        eq(schema.dataSources.userId, row.userId),
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

    let storedRow: {
      id: string;
      userId: string;
      type: string;
      token: string | null;
      username: string | null;
      password: string | null;
    } | undefined;
    if (body.id) {
      storedRow = db.select().from(schema.dataSources)
        .where(eq(schema.dataSources.id, body.id))
        .get();
      if (!storedRow || !canMutateDataSource(locals, storedRow.userId)) {
        return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // If token is masked, retrieve the stored one
    let resolvedToken = token;
    if (token === '********' && storedRow?.token) {
      resolvedToken = decrypt(storedRow.token) || '';
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

    let sourceType = (body.type || body.sourceType || 'influxdb') as string;
    if (storedRow && !body.type && !body.sourceType && storedRow.type) {
      sourceType = storedRow.type;
    }

    // Resolve username/password for Graylog
    let resolvedUsername = (body.username || '').trim();
    let resolvedPassword = (body.password || '').trim();
    if (storedRow && (resolvedPassword === '********' || (!resolvedPassword && !resolvedUsername))) {
      if (storedRow.username) resolvedUsername = storedRow.username;
      if (storedRow.password) resolvedPassword = decrypt(storedRow.password) || '';
    }

    let result: { ok: boolean; error?: string };
    if (sourceType === 'prometheus') {
      result = await testPrometheusConnection({ url, token: resolvedToken });
    } else if (sourceType === 'influxdb') {
      result = await testInfluxConnection({ url, token: resolvedToken, org, bucket });
    } else {
      result = await testSourceConnection(sourceType, {
        url,
        token: resolvedToken,
        username: resolvedUsername,
        password: resolvedPassword,
      });
    }

    // Update last test status if we have an ID
    if (body.id && storedRow) {
      db.update(schema.dataSources).set({
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? 'ok' : (result.error || 'error'),
        updatedAt: new Date(),
      }).where(and(
        eq(schema.dataSources.id, body.id),
        eq(schema.dataSources.userId, storedRow.userId),
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
