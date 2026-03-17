import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../lib/db';
import { diagnoseIncident } from '../../../lib/diagnose';
import { logAudit, getClientIp } from '../../../lib/audit';
import { notify } from '../../../lib/notify';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { incidentId } = body;
  if (!incidentId) return new Response('Missing incidentId', { status: 400 });

  const db = getTenantDb(locals.user.id);
  const incident = db.select().from(tenantSchema.incidents).where(eq(tenantSchema.incidents.id, incidentId)).get();
  if (!incident || incident.userId !== locals.user.id) {
    return new Response('Not found', { status: 404 });
  }

  // Get stack context
  let stackContext = 'No stack description provided.';
  if (incident.stackId) {
    const stack = db.select().from(tenantSchema.stacks).where(eq(tenantSchema.stacks.id, incident.stackId)).get();
    if (stack) stackContext = stack.description;
  }

  // Get past resolutions for similar incidents (FTS5 search)
  const pastResolutions: string[] = [];
  try {
    const rawDb = (db as any)._.session?.client;
    if (rawDb?.prepare) {
      const ftsResults = rawDb.prepare(
        `SELECT r.content FROM resolutions r
         JOIN incidents i ON r.incident_id = i.id
         WHERE i.user_id = ? AND i.id != ?
         ORDER BY r.created_at DESC LIMIT 3`
      ).all(locals.user.id, incidentId);
      for (const row of ftsResults) {
        if (row.content) pastResolutions.push(row.content);
      }
    }
  } catch { /* FTS may not be populated yet */ }

  const tier = locals.user.subscriptionStatus === 'active' ? 'paid' : 'free';
  const description = `Title: ${incident.title}\n\n${incident.description}`;

  try {
    const result = await diagnoseIncident({
      stackContext,
      incidentDescription: description,
      pastResolutions,
      tier,
    });

    // Store diagnosis
    const diagId = nanoid();
    db.insert(tenantSchema.diagnoses).values({
      id: diagId,
      incidentId,
      rootCauses: JSON.stringify(result.rootCauses),
      suggestedCommands: JSON.stringify(result.suggestedCommands),
      matchedIncidentIds: null,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      createdAt: new Date(),
    }).run();

    notify(locals.user.id, {
      event: 'diagnosis_complete',
      title: `Diagnosis: ${incident.title}`,
      body: result.rootCauses[0] || 'Analysis complete',
      url: `/app/incidents/${incidentId}`,
      metadata: { model: result.model, incidentId },
    });

    logAudit('ai_diagnosis', {
      userId: locals.user.id,
      ip: getClientIp(request),
      details: { incidentId, model: result.model, tokens: result.promptTokens + result.completionTokens },
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Diagnosis error:', err);
    const status = err?.status === 429 ? 429 : 500;
    const message = status === 429
      ? 'AI service is busy. Please try again in a moment.'
      : 'Diagnosis failed. Please try again later.';
    return new Response(JSON.stringify({ error: message, retryable: status >= 429 }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
