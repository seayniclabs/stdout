import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { sql } from 'drizzle-orm';

/**
 * Observatory Metrics API — Internal endpoint for agent tools
 *
 * Returns current metrics for all stacks or filtered by stack_id.
 * No auth required — only accessible from internal agent context.
 */
export const GET: APIRoute = async ({ url }) => {
  const stackId = url.searchParams.get('stack_id');
  const db = getDb();

  try {
    if (stackId) {
      // Single stack metrics
      const stack = await db.get(sql`
        SELECT id, name, description FROM stacks WHERE id = ${stackId}
      `);

      if (!stack) {
        return new Response(JSON.stringify({ error: 'Stack not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Get latest metrics for this stack
      const metrics = await db.all(sql`
        SELECT metric_name, value, unit, timestamp
        FROM metrics
        WHERE stack_id = ${stackId}
        ORDER BY timestamp DESC
        LIMIT 10
      `);

      return new Response(JSON.stringify({
        stack,
        metrics: metrics || [],
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // All stacks with latest metrics
    const stacks = await db.all(sql`SELECT id, name, description FROM stacks`);
    const result = [];

    for (const stack of stacks as any[]) {
      const metrics = await db.all(sql`
        SELECT metric_name, value, unit, timestamp
        FROM metrics
        WHERE stack_id = ${stack.id}
        ORDER BY timestamp DESC
        LIMIT 5
      `);

      result.push({
        stack,
        metrics: metrics || [],
      });
    }

    return new Response(JSON.stringify({ stacks: result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[Observatory API] metrics error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
