import type { APIRoute} from 'astro';
import { getDb } from '../../../../lib/db';
import { sql } from 'drizzle-orm';

/**
 * Observatory Incidents API — Internal endpoint for agent tools
 *
 * Returns incidents filtered by status and severity.
 * No auth required — only accessible from internal agent context.
 */
export const GET: APIRoute = async ({ url }) => {
  const status = url.searchParams.get('status');
  const severity = url.searchParams.get('severity');
  const db = getDb();

  try {
    let query = sql`
      SELECT
        id, title, description, severity, status,
        created_at, resolved_at, stack_id
      FROM incidents
      WHERE 1=1
    `;

    // Build filter conditions
    const conditions = [];
    if (status) {
      conditions.push(sql`status = ${status}`);
    }
    if (severity) {
      conditions.push(sql`severity = ${severity}`);
    }

    // Combine conditions
    if (conditions.length > 0) {
      query = sql`
        SELECT
          id, title, description, severity, status,
          created_at, resolved_at, stack_id
        FROM incidents
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY created_at DESC
        LIMIT 50
      `;
    } else {
      query = sql`
        SELECT
          id, title, description, severity, status,
          created_at, resolved_at, stack_id
        FROM incidents
        ORDER BY created_at DESC
        LIMIT 50
      `;
    }

    const incidents = await db.all(query);

    return new Response(JSON.stringify({
      incidents: incidents || [],
      total: incidents?.length || 0,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[Observatory API] incidents error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
