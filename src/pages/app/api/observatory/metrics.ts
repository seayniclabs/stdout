import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../../../../lib/rbac';

/**
 * Observatory Metrics API — Internal endpoint for agent tools
 *
 * Returns current metrics for all stacks or filtered by stack_id.
 * Auth required for proper user context.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const userId = locals.user.id;
  const stackId = url.searchParams.get('stack_id');
  const db = getDb();
  const rawDb = (db as any).$client;

  try {
    if (stackId) {
      // Single stack metrics
      const stack = await rawDb.prepare(`
        SELECT id, name, description FROM stacks WHERE id = ?
      `).get(stackId);

      if (!stack) {
        return new Response(JSON.stringify({ error: 'Stack not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Get latest metrics for this stack
      const metrics = await rawDb.prepare(`
        SELECT metric_name, value, unit, timestamp
        FROM metrics
        WHERE stack_id = ?
        ORDER BY timestamp DESC
        LIMIT 10
      `).all(stackId);

      return new Response(JSON.stringify({
        stack,
        metrics: metrics || [],
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // All stacks with latest metrics
    const stacks = await rawDb.prepare(`SELECT id, name, description FROM stacks`).all();
    const result = [];

    for (const stack of stacks as any[]) {
      const metrics = await rawDb.prepare(`
        SELECT metric_name, value, unit, timestamp
        FROM metrics
        WHERE stack_id = ?
        ORDER BY timestamp DESC
        LIMIT 5
      `).all(stack.id);

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
