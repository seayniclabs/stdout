import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { diagnoseIncident } from '../../../lib/diagnose';
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

  const db = getDb();
  const incident = db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId)).get();
  if (!incident || incident.userId !== locals.user.id) {
    return new Response('Not found', { status: 404 });
  }

  // Get stack context
  let stackContext = 'No stack description provided.';
  if (incident.stackId) {
    const stack = db.select().from(schema.stacks).where(eq(schema.stacks.id, incident.stackId)).get();
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
    db.insert(schema.diagnoses).values({
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

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Diagnosis error:', err);
    return new Response(err.message || 'Diagnosis failed', { status: 500 });
  }
};
