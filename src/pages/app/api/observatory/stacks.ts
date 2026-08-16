import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../../../../lib/rbac';

/**
 * Observatory Stacks API — Internal endpoint for agent tools
 *
 * Returns all configured stacks.
 * Auth required for proper user context.
 */
export const GET: APIRoute = async ({ locals }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const userId = locals.user.id;
  const db = getDb();
  const rawDb = (db as any).$client;

  try {
    const stacks = await rawDb.prepare(`
      SELECT
        id, name, description, type, created_at, updated_at
      FROM stacks
      ORDER BY name ASC
    `).all();

    // Get monitor count per stack
    const stacksWithCounts = await Promise.all(
      (stacks as any[]).map(async (stack) => {
        const monitorCount = await rawDb.prepare(`
          SELECT COUNT(*) as count FROM monitors WHERE stack_id = ?
        `).get(stack.id);

        const incidentCount = await rawDb.prepare(`
          SELECT COUNT(*) as count FROM incidents
          WHERE stack_id = ? AND status = 'active'
        `).get(stack.id);

        return {
          ...stack,
          monitor_count: (monitorCount as any)?.count || 0,
          active_incidents: (incidentCount as any)?.count || 0,
        };
      })
    );

    return new Response(JSON.stringify({
      stacks: stacksWithCounts,
      total: stacks?.length || 0,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[Observatory API] stacks error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
