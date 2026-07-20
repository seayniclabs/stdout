import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { notify } from '../../../../lib/notify';
import { createOrDeduplicateIncident } from '../../../../lib/incident-dedup';

/**
 * POST /app/api/incidents/webhook
 *
 * Create an incident from an external source (monitoring tool, n8n workflow,
 * CI pipeline, etc). Requires Bearer token auth (same tokens as scanner).
 *
 * **Deduplication:** Incidents with the same fingerprint (title + description
 * + severity + stack) within a 60-minute window are deduplicated automatically.
 * Duplicate arrivals increment the occurrence count instead of creating new incidents.
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
 * Response: { incidentId, url, isDuplicate, occurrenceCount }
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <token>' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

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
    const db = getDb();
    const stack = db.select().from(schema.stacks)
      .where(eq(schema.stacks.id, stackId)).get();
    if (!stack) {
      return new Response(JSON.stringify({ error: 'Stack not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Create or deduplicate incident
  const dedupResult = createOrDeduplicateIncident(locals.user.id, {
    title,
    description,
    severity,
    stackId,
    tags: tags || null,
  });

  const { incidentId, isDuplicate, occurrenceCount } = dedupResult;

  // Fire notifications only for NEW incidents (not duplicates)
  if (!isDuplicate) {
    notify(locals.user.id, {
      event: 'incident_created',
      title: `[${severity.toUpperCase()}] ${title}`,
      body: description.slice(0, 200),
      url: `/app/incidents/${incidentId}`,
    }).catch(() => {});

    if (severity === 'critical') {
      notify(locals.user.id, {
        event: 'severity_critical',
        title: `CRITICAL: ${title}`,
        body: description.slice(0, 200),
        url: `/app/incidents/${incidentId}`,
      }).catch(() => {});
    }
  } else {
    // Optional: notify on high occurrence count
    if (occurrenceCount && occurrenceCount >= 5 && occurrenceCount % 5 === 0) {
      notify(locals.user.id, {
        event: 'incident_recurring',
        title: `${title} (${occurrenceCount} occurrences)`,
        body: 'This incident is recurring frequently. Consider investigating the root cause.',
        url: `/app/incidents/${incidentId}`,
      }).catch(() => {});
    }
  }

  return new Response(JSON.stringify({
    incidentId,
    url: `/app/incidents/${incidentId}`,
    isDuplicate,
    occurrenceCount: occurrenceCount || 1,
  }), {
    status: isDuplicate ? 200 : 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
