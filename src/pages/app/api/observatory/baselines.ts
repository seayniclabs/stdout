import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { sql } from 'drizzle-orm';

/**
 * Observatory Baselines API — Internal endpoint for agent tools
 *
 * Returns established baselines for a stack.
 * No auth required — only accessible from internal agent context.
 */
export const GET: APIRoute = async ({ url }) => {
  const stackId = url.searchParams.get('stack_id');

  if (!stackId) {
    return new Response(JSON.stringify({ error: 'stack_id parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();

  try {
    const baselines = await db.all(sql`
      SELECT
        metric_name, baseline_value, threshold_high, threshold_low,
        confidence_score, sample_count, updated_at
      FROM baselines
      WHERE stack_id = ${stackId}
      ORDER BY metric_name ASC
    `);

    return new Response(JSON.stringify({
      stack_id: stackId,
      baselines: baselines || [],
      total: baselines?.length || 0,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[Observatory API] baselines error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
