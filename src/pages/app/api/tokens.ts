import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { logAudit, getClientIp } from '../../../lib/audit';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth, checkRBAC } from '../../../lib/rbac';
import { validateCsrf } from '../../../middleware';

// Token format: stdout_scan_{nanoid(32)}
function generateToken(): string {
  return `stdout_scan_${nanoid(32)}`;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const GET: APIRoute = async ({ locals }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // SECURITY FIX (2026-08-16): Filter tokens by user ID to prevent privilege escalation
  const db = getDb();
  const tokens = db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      createdAt: schema.apiTokens.createdAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, locals.user!.id))
    .all();

  return new Response(JSON.stringify({ tokens }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_tokens');
  if (rbacError) return rbacError;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        module: 'tokens',
        timestamp: new Date().toISOString(),
        msg: 'Failed to parse request JSON',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token') || (body._csrf as string);
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const name = (body.name as string || '').trim();
  if (!name) {
    return new Response(JSON.stringify({ error: 'Token name is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Default: token expires in 90 days
  const expirationDays = typeof body.expirationDays === 'number' ? body.expirationDays : 90;
  if (expirationDays < 1 || expirationDays > 365) {
    return new Response(
      JSON.stringify({
        error: 'Token expiration must be between 1 and 365 days',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const id = nanoid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expirationDays * 24 * 60 * 60 * 1000);

  getDb()
    .insert(schema.apiTokens)
    .values({
      id,
      name,
      tokenHash,
      expiresAt,
      createdAt: now,
    })
    .run();

  logAudit('token_create', {
    ip: getClientIp(request),
    details: { tokenId: id, name, expiresAt: expiresAt.toISOString() },
  });

  // Raw token is shown ONCE — never stored or retrievable again
  return new Response(JSON.stringify({ token: rawToken, id, name, expiresAt }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_tokens');
  if (rbacError) return rbacError;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        module: 'tokens',
        timestamp: new Date().toISOString(),
        msg: 'Failed to parse request JSON',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSRF check
  const csrfToken = request.headers.get('x-csrf-token') || (body._csrf as string);
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const tokenId = body.id as string | undefined;
  if (!tokenId) {
    return new Response(JSON.stringify({ error: 'Token ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SECURITY FIX (2026-08-16): Verify token ownership before deletion to prevent IDOR
  getDb()
    .delete(schema.apiTokens)
    .where(and(eq(schema.apiTokens.id, tokenId), eq(schema.apiTokens.userId, locals.user!.id)))
    .run();

  logAudit('token_revoke', {
    ip: getClientIp(request),
    details: { tokenId },
  });

  return new Response(JSON.stringify({ revoked: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
