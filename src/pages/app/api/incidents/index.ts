import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../../lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

/**
 * GET /app/api/incidents
 * List incidents with optional filters: ?status=active&severity=critical&limit=50
 */
export const GET: APIRoute = async ({ locals, url }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();

  const id = url.searchParams.get('id');

  // Single incident by ID
  if (id) {
    const incident = db.select().from(schema.incidents)
      .where(and(eq(schema.incidents.id, id), eq(schema.incidents.userId, locals.user.id)))
      .get();
    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Include resolutions and latest diagnosis
    const resolutions = db.select().from(schema.resolutions)
      .where(eq(schema.resolutions.incidentId, id))
      .orderBy(desc(schema.resolutions.createdAt))
      .all();

    const diagnosis = db.select().from(schema.diagnoses)
      .where(eq(schema.diagnoses.incidentId, id))
      .orderBy(desc(schema.diagnoses.createdAt))
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
  let query = db.select().from(schema.incidents)
    .where(eq(schema.incidents.userId, locals.user.id))
    .orderBy(desc(schema.incidents.createdAt));

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
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'create');
  if (rbacError) return rbacError;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        module: 'incidents',
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

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();
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

    db.insert(schema.incidents).values({
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
    } catch (err) {
      // FTS table may not exist; continue without full-text indexing
      console.warn(
        JSON.stringify({
          level: 'WARN',
          module: 'incidents',
          timestamp: new Date().toISOString(),
          msg: 'Failed to index incident in FTS, continuing without full-text search',
          error: err instanceof Error ? err.message : String(err),
          incidentId: id,
        })
      );
    }

    const incident = db.select().from(schema.incidents)
      .where(eq(schema.incidents.id, id)).get();

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

    const incident = db.select().from(schema.incidents)
      .where(and(eq(schema.incidents.id, incidentId), eq(schema.incidents.userId, locals.user.id)))
      .get();

    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const updates: any = { status, updatedAt: new Date() };
    if (status === 'resolved') updates.resolvedAt = new Date();

    db.update(schema.incidents).set(updates)
      .where(and(
        eq(schema.incidents.id, incidentId),
        eq(schema.incidents.userId, locals.user.id),
      )).run();

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

    const incident = db.select().from(schema.incidents)
      .where(and(eq(schema.incidents.id, incidentId), eq(schema.incidents.userId, locals.user.id)))
      .get();

    if (!incident) {
      return new Response(JSON.stringify({ error: 'Incident not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const resId = nanoid();
    db.insert(schema.resolutions).values({
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
    } catch (err) {
      // FTS table may not exist; continue without full-text indexing
      console.warn(
        JSON.stringify({
          level: 'WARN',
          module: 'incidents',
          timestamp: new Date().toISOString(),
          msg: 'Failed to index resolution in FTS, continuing without full-text search',
          error: err instanceof Error ? err.message : String(err),
          resolutionId: resId,
        })
      );
    }

    // Closed-loop learning: auto-document this incident IF it's novel/rare. Fire-and-forget —
    // never blocks or breaks the resolution. Scrubs secrets before storing (PII-grade).
    import('../../../../lib/observatory/auto-doc')
      .then(({ maybeAutoDocument }) => maybeAutoDocument(userId, incidentId))
      .catch((err) => {
        // Auto-doc is best-effort; log the error but don't block
        console.warn(
          JSON.stringify({
            level: 'WARN',
            module: 'incidents',
            timestamp: new Date().toISOString(),
            msg: 'Auto-documentation failed, continuing',
            error: err instanceof Error ? err.message : String(err),
            incidentId,
          })
        );
      });

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
export const DELETE: APIRoute = async ({ locals, url, cookies, request }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'delete');
  if (rbacError) return rbacError;

  // CSRF check - DELETE uses header or query param
  const csrfFromHeader = request.headers.get('x-csrf-token');
  const csrfFromQuery = url.searchParams.get('_csrf');
  const csrfToken = csrfFromHeader || csrfFromQuery;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'id query param is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();

  const incident = db.select().from(schema.incidents)
    .where(and(eq(schema.incidents.id, id), eq(schema.incidents.userId, locals.user.id)))
    .get();

  if (!incident) {
    return new Response(JSON.stringify({ error: 'Incident not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete resolutions and diagnoses first (incident already verified; resolutions may be authored by multiple users)
  db.delete(schema.resolutions).where(eq(schema.resolutions.incidentId, id)).run();
  db.delete(schema.diagnoses).where(eq(schema.diagnoses.incidentId, id)).run();
  db.delete(schema.incidents).where(and(
    eq(schema.incidents.id, id),
    eq(schema.incidents.userId, incident.userId),
  )).run();

  return new Response(JSON.stringify({ ok: true, deleted: id }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
