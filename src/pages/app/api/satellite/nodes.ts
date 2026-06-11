import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { getCentralDb } from '../../../../lib/db';
import { logAudit, getClientIp } from '../../../../lib/audit';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { emit } from '../../../../lib/events';

// sat_<nanoid(32)> — distinct prefix from scanner tokens
function generateToken(): string {
  return `sat_${nanoid(32)}`;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** GET /app/api/satellite/nodes — list enrolled nodes */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getCentralDb();
  const rows = db.all(sql`
    SELECT id, name, description, tags, last_seen, last_report, alert_state, created_at
    FROM satellite_agents
    WHERE user_id = ${locals.user.id}
    ORDER BY created_at DESC
  `) as any[];

  const nodes = rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    tags: JSON.parse(r.tags || '[]'),
    lastSeen: r.last_seen,
    lastReport: r.last_report ? JSON.parse(r.last_report) : null,
    alertState: r.alert_state,
    createdAt: r.created_at,
  }));

  return new Response(JSON.stringify({ nodes }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** POST /app/api/satellite/nodes — register a new node */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const name = (body.name || '').trim();
  if (!name) {
    return new Response(JSON.stringify({ error: 'Node name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const description = (body.description || '').trim() || null;
  const tags = Array.isArray(body.tags) ? body.tags : [];

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  const db = getCentralDb();
  db.run(sql`
    INSERT INTO satellite_agents (id, user_id, name, description, tags, token_hash, alert_state, created_at)
    VALUES (${id}, ${locals.user.id}, ${name}, ${description}, ${JSON.stringify(tags)}, ${tokenHash}, 'ok', ${now})
  `);

  logAudit('satellite_node_register', {
    userId: locals.user.id,
    ip: getClientIp(request),
    details: { nodeId: id, name },
  });

  emit({ type: 'satellite.registered', userId: locals.user.id, agentId: id, name, tags });

  return new Response(JSON.stringify({ node_id: id, api_token: rawToken, name }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** DELETE /app/api/satellite/nodes — deregister a node */
export const DELETE: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const nodeId = (body.id || '').trim();
  if (!nodeId) {
    return new Response(JSON.stringify({ error: 'Node ID required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getCentralDb();
  // Verify ownership before delete
  const existing = db.get(sql`
    SELECT id FROM satellite_agents WHERE id = ${nodeId} AND user_id = ${locals.user.id}
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
