import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { logAudit, getClientIp } from '../../../lib/audit';
import { eq, and } from 'drizzle-orm';

// Token format: stdout_scan_{nanoid(32)}
function generateToken(): string {
  return `stdout_scan_${nanoid(32)}`;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const tokens = getDb().select({
    id: schema.apiTokens.id,
    name: schema.apiTokens.name,
    lastUsedAt: schema.apiTokens.lastUsedAt,
    createdAt: schema.apiTokens.createdAt,
  })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, locals.user.id))
    .all();

  return new Response(JSON.stringify({ tokens }), {
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

  const name = (body.name || '').trim();
  if (!name) {
    return new Response(JSON.stringify({ error: 'Token name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const id = nanoid();

  getDb().insert(schema.apiTokens).values({
    id,
    userId: locals.user.id,
    name,
    tokenHash,
    createdAt: new Date(),
  }).run();

  logAudit('token_create', {
    userId: locals.user.id,
    ip: getClientIp(request),
    details: { tokenId: id, name },
  });

  // Raw token is shown ONCE — never stored or retrievable again
  return new Response(JSON.stringify({ token: rawToken, id, name }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const tokenId = body.id;
  if (!tokenId) {
    return new Response(JSON.stringify({ error: 'Token ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  getDb().delete(schema.apiTokens)
    .where(and(eq(schema.apiTokens.id, tokenId), eq(schema.apiTokens.userId, locals.user.id)))
    .run();

  logAudit('token_revoke', {
    userId: locals.user.id,
    ip: getClientIp(request),
    details: { tokenId },
  });

  return new Response(JSON.stringify({ revoked: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
