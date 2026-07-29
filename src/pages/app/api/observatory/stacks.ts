import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { sql } from 'drizzle-orm';

/**
 * Observatory Stacks API — Internal endpoint for agent tools
 *
 * Returns all configured stacks.
 * No auth required — only accessible from internal agent context.
 */
export const GET: APIRoute = async () => {
  const db = getDb();

  try {
    const stacks = await db.all(sql`
      SELECT
        id, name, description, type, created_at, updated_at
      FROM stacks
      ORDER BY name ASC
    `);

    // Get monitor count per stack
    const stacksWithCounts = await Promise.all(
      (stacks as any[]).map(async (stack) => {
        const monitorCount = await db.get(sql`
          SELECT COUNT(*) as count FROM monitors WHERE stack_id = ${stack.id}
        `);

        const incidentCount = await db.get(sql`
          SELECT COUNT(*) as count FROM incidents
          WHERE stack_id = ${stack.id} AND status = 'active'
        `);

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
