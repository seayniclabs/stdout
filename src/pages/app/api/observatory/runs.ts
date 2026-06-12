/**
 * Observatory Agent Runs History
 *
 * GET /app/api/observatory/runs
 * Returns recent agent run history
 */

import type { APIRoute } from 'astro';
import { getCentralDb } from '../../../../lib/db';
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
    const db = getCentralDb();
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const agentName = url.searchParams.get('agent'); // Filter by agent

    const conditions = ['user_id = ?'];
    const params: any[] = [userId];

    if (agentName) {
      conditions.push('agent_name = ?');
      params.push(agentName);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const query = `
      SELECT
        id,
        agent_name,
        stack_id,
        trigger,
        decision_made,
        confidence_score,
        execution_time_ms,
        created_at,
        input_context,
        output_decision
      FROM observatory_agent_runs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const rawDb = (db as any).$client;
    const rows = (rawDb?.prepare ? rawDb.prepare(query).all(...params, limit) : []) as any[];

    const runs = rows.map(row => ({
      id: row.id,
      agentName: row.agent_name,
      stackId: row.stack_id,
      trigger: row.trigger,
      decisionMade: row.decision_made,
      confidenceScore: row.confidence_score,
      executionTimeMs: row.execution_time_ms,
      createdAt: new Date(row.created_at).toISOString(),
      // Parse JSON fields
      inputContext: JSON.parse(row.input_context),
      outputDecision: JSON.parse(row.output_decision)
    }));

    return new Response(JSON.stringify({
      runs,
      count: runs.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[Observatory Runs API] Error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch runs',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
