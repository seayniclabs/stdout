import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { notify } from '../../../../lib/notify';

/**
 * POST /app/api/incidents/webhook
 *
 * Create an incident from an external source (monitoring tool, n8n workflow,
 * CI pipeline, etc). Requires Bearer token auth (same tokens as scanner).
 *
 * Request body:
 * {
 *   "title": "nginx 502 on production",          // required
 *   "description": "Error output...",             // required
 *   "severity": "high",                           // optional: critical|high|medium|low (default: medium)
 *   "stackId": "stack-id",                        // optional: link to a stack
 *   "tags": "nginx,production,502"                // optional: comma-separated
 * }
 *
 * Response: { incidentId, url }
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <token>' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const title = (body.title || '').trim();
  const description = (body.description || '').trim();

  if (!title) {
    return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (!description) {
    return new Response(JSON.stringify({ error: 'description is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const validSeverities = ['critical', 'high', 'medium', 'low'];
  const severity = validSeverities.includes(body.severity) ? body.severity : 'medium';
  const tags = (body.tags || '').trim();
  const stackId = body.stackId || null;

  // Validate stack if provided
  if (stackId) {
    const db = getTenantDb(locals.user.id);
    const stack = db.select().from(tenantSchema.stacks)
      .where(eq(tenantSchema.stacks.id, stackId)).get();
    if (!stack) {
      return new Response(JSON.stringify({ error: 'Stack not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const id = nanoid();
  const now = new Date();
  const db = getTenantDb(locals.user.id);

  db.insert(tenantSchema.incidents).values({
    id,
    userId: locals.user.id,
    stackId,
    title,
    description,
    severity,
    status: 'active',
    tags: tags || null,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Fire notifications
  notify(locals.user.id, {
    event: 'incident_created',
    title: `[${severity.toUpperCase()}] ${title}`,
    body: description.slice(0, 200),
    url: `/app/incidents/${id}`,
  }).catch(() => {});

  if (severity === 'critical') {
    notify(locals.user.id, {
      event: 'severity_critical',
      title: `CRITICAL: ${title}`,
      body: description.slice(0, 200),
      url: `/app/incidents/${id}`,
    }).catch(() => {});
  }

  return new Response(JSON.stringify({
    incidentId: id,
    url: `/app/incidents/${id}`,
  }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};
