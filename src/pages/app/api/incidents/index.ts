import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /app/api/incidents
 * List incidents with optional filters: ?status=active&severity=critical&limit=50
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);

  const id = url.searchParams.get('id');

  // Single incident by ID
  if (id) {
    const incident = db.select().from(tenantSchema.incidents)
      .where(and(eq(tenantSchema.incidents.id, id), eq(tenantSchema.incidents.userId, locals.user.id)))
      .get();
    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Include resolutions and latest diagnosis
    const resolutions = db.select().from(tenantSchema.resolutions)
      .where(eq(tenantSchema.resolutions.incidentId, id))
      .orderBy(desc(tenantSchema.resolutions.createdAt))
      .all();

    const diagnosis = db.select().from(tenantSchema.diagnoses)
      .where(eq(tenantSchema.diagnoses.incidentId, id))
      .orderBy(desc(tenantSchema.diagnoses.createdAt))
      .limit(1)
      .all();

    return new Response(JSON.stringify({
      incident,
      resolutions,
      diagnosis: diagnosis[0] || null,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // List with filters
  let query = db.select().from(tenantSchema.incidents)
    .where(eq(tenantSchema.incidents.userId, locals.user.id))
    .orderBy(desc(tenantSchema.incidents.createdAt));

  const allIncidents = query.all();

  // Apply filters in JS (simpler than dynamic query building)
  let filtered = allIncidents;
  const statusFilter = url.searchParams.get('status');
  if (statusFilter) filtered = filtered.filter(i => i.status === statusFilter);
  const severityFilter = url.searchParams.get('severity');
  if (severityFilter) filtered = filtered.filter(i => i.severity === severityFilter);

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  filtered = filtered.slice(0, limit);

  return new Response(JSON.stringify({ incidents: filtered, total: allIncidents.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * POST /app/api/incidents
 * Actions: create, update_status, add_resolution
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);
  const action = body.action || 'create';

  // --- Create incident ---
  if (action === 'create') {
    const { title, description, severity, stackId, tags } = body;
    if (!title || !description) {
      return new Response(JSON.stringify({ error: 'title and description are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const id = nanoid();
    const now = new Date();

    db.insert(tenantSchema.incidents).values({
      id,
      userId: locals.user.id,
      title,
      description,
      severity: severity || 'medium',
      status: 'active',
      stackId: stackId || null,
      tags: tags || null,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Index in FTS
    try {
      const rawDb = (db as any).$client;
      if (rawDb?.prepare) {
        rawDb.prepare(
          'INSERT INTO incidents_fts(rowid, title, description, tags) SELECT rowid, title, description, tags FROM incidents WHERE id = ?'
        ).run(id);
      }
    } catch { /* FTS may not exist */ }

    const incident = db.select().from(tenantSchema.incidents)
      .where(eq(tenantSchema.incidents.id, id)).get();

    return new Response(JSON.stringify({ id, incident }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Update status ---
  if (action === 'update_status') {
    const { incidentId, status } = body;
    if (!incidentId || !status) {
      return new Response(JSON.stringify({ error: 'incidentId and status are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const valid = ['active', 'investigating', 'monitoring', 'resolved'];
    if (!valid.includes(status)) {
      return new Response(JSON.stringify({ error: `status must be one of: ${valid.join(', ')}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const incident = db.select().from(tenantSchema.incidents)
      .where(and(eq(tenantSchema.incidents.id, incidentId), eq(tenantSchema.incidents.userId, locals.user.id)))
      .get();

    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const updates: any = { status, updatedAt: new Date() };
    if (status === 'resolved') updates.resolvedAt = new Date();

    db.update(tenantSchema.incidents).set(updates)
      .where(eq(tenantSchema.incidents.id, incidentId)).run();

    return new Response(JSON.stringify({ ok: true, incidentId, status }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Add resolution ---
  if (action === 'add_resolution') {
    const { incidentId, content } = body;
    if (!incidentId || !content) {
      return new Response(JSON.stringify({ error: 'incidentId and content are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const incident = db.select().from(tenantSchema.incidents)
      .where(and(eq(tenantSchema.incidents.id, incidentId), eq(tenantSchema.incidents.userId, locals.user.id)))
      .get();

    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const resId = nanoid();
    db.insert(tenantSchema.resolutions).values({
      id: resId,
      incidentId,
      userId: locals.user.id,
      content,
      createdAt: new Date(),
    }).run();

    // Index in FTS
    try {
      const rawDb = (db as any).$client;
      if (rawDb?.prepare) {
        rawDb.prepare(
          'INSERT INTO resolutions_fts(rowid, content) SELECT rowid, content FROM resolutions WHERE id = ?'
        ).run(resId);
      }
    } catch { /* FTS may not exist */ }

    return new Response(JSON.stringify({ ok: true, id: resId, incidentId }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action. Use: create, update_status, add_resolution' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * DELETE /app/api/incidents?id=xxx
 * Delete an incident and its resolutions/diagnoses.
 */
export const DELETE: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'id query param is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);

  const incident = db.select().from(tenantSchema.incidents)
    .where(and(eq(tenantSchema.incidents.id, id), eq(tenantSchema.incidents.userId, locals.user.id)))
    .get();

  if (!incident) {
    return new Response(JSON.stringify({ error: 'Incident not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete resolutions and diagnoses first
  db.delete(tenantSchema.resolutions).where(eq(tenantSchema.resolutions.incidentId, id)).run();
  db.delete(tenantSchema.diagnoses).where(eq(tenantSchema.diagnoses.incidentId, id)).run();
  db.delete(tenantSchema.incidents).where(eq(tenantSchema.incidents.id, id)).run();

  return new Response(JSON.stringify({ ok: true, deleted: id }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
