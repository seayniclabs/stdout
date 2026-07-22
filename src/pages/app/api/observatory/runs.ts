/**
 * Observatory Agent Runs History
 *
 * GET /app/api/observatory/runs
 * Returns recent agent run history
 */

import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { sql } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const userId = locals.workspace?.ownerId || locals.user.id;

  try {
    const db = getDb();
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const agentType = url.searchParams.get('agent'); // Filter by agent type

    const conditions = ['user_id = ?'];
    const params: unknown[] = [userId];

    if (agentType) {
      conditions.push('agent_type = ?');
      params.push(agentType);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const query = `
      SELECT
        id,
        agent_type,
        incident_id,
        model,
        prompt_tokens,
        completion_tokens,
        outcome,
        execution_time_ms,
        created_at
      FROM observatory_agent_runs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const rawDb = (db as any).$client;
    const rows = (rawDb?.prepare ? rawDb.prepare(query).all(...params, limit) : []) as any[];

    const runs = rows.map(row => ({
      id: row.id,
      agentType: row.agent_type,
      incidentId: row.incident_id,
      model: row.model,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      outcome: row.outcome,
      executionTimeMs: row.execution_time_ms,
      createdAt: new Date(row.created_at).toISOString()
    }));

    return new Response(JSON.stringify({
      runs,
      count: runs.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    console.error('[Observatory Runs API] Error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch runs',
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
