import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../../lib/db';
import { logAudit, getClientIp } from '../../../../lib/audit';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { emit } from '../../../../lib/events';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';

// sat_<nanoid(32)> — distinct prefix from scanner tokens
function generateToken(): string {
  return `sat_${nanoid(32)}`;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** GET /app/api/satellite/nodes — list enrolled nodes */
export const GET: APIRoute = async ({ locals }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  const db = getDb();
  const rows = db.all(sql`
    SELECT id, name, hostname, ip_address, last_seen_at, created_at
    FROM satellite_agents
    ORDER BY created_at DESC
  `) as any[];

  const nodes = rows.map(r => ({
    id: r.id,
    name: r.name,
    hostname: r.hostname,
    ipAddress: r.ip_address,
    lastSeen: r.last_seen_at,
    createdAt: r.created_at,
  }));

  return new Response(JSON.stringify({ nodes }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** POST /app/api/satellite/nodes — register a new node */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - managing satellite nodes requires manage_settings
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const name = (body.name || '').trim();
  if (!name) {
    return new Response(JSON.stringify({ error: 'Node name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const hostname = (body.hostname || '').trim() || 'unknown';
  const ipAddress = (body.ipAddress || body.ip_address || '').trim() || 'unknown';

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  const db = getDb();
  db.run(sql`
    INSERT INTO satellite_agents (id, name, hostname, ip_address, api_key, created_at)
    VALUES (${id}, ${name}, ${hostname}, ${ipAddress}, ${tokenHash}, ${now})
  `);

  logAudit('satellite_node_register', {
    userId: locals.user.id,
    ip: getClientIp(request),
    details: { nodeId: id, name },
  });

  emit({ type: 'satellite.registered', userId: locals.user.id, agentId: id, name, hostname, ipAddress });

  return new Response(JSON.stringify({ node_id: id, api_token: rawToken, name }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** DELETE /app/api/satellite/nodes — deregister a node */
export const DELETE: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - managing satellite nodes requires manage_settings
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const nodeId = (body.id || '').trim();
  if (!nodeId) {
    return new Response(JSON.stringify({ error: 'Node ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDb();
  // Verify node exists before delete
  const existing = db.get(sql`
    SELECT id FROM satellite_agents WHERE id = ${nodeId}
  `) as any;

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Node not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  db.run(sql`DELETE FROM satellite_agents WHERE id = ${nodeId}`);

  logAudit('satellite_node_deregister', {
    userId: locals.user.id,
    ip: getClientIp(request),
    details: { nodeId },
  });

  return new Response(JSON.stringify({ removed: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
