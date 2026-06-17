import type { APIRoute } from 'astro';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../lib/db';

type MissingSource = {
  type?: string;
  recommendation?: string;
  reason?: string;
};

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getDb();

  const latestImport = db.select()
    .from(schema.stackImports)
    .where(and(
      eq(schema.stackImports.status, 'confirmed'),
    ))
    .orderBy(desc(schema.stackImports.createdAt))
    .limit(20)
    .all()
    // Prefer imports that contain scanner modules with data_sources.
    .find((row) => {
      try {
        const parsed = JSON.parse(row.rawJson);
        return parsed?.data_sources?.missing && Array.isArray(parsed.data_sources.missing);
      } catch {
        return false;
      }
    });

  if (!latestImport) {
    return new Response(JSON.stringify({ recommendations: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsed = JSON.parse(latestImport.rawJson);
    const missing = (parsed?.data_sources?.missing || []) as MissingSource[];

    const recommendations = missing
      .filter((m) => m && (m.type || m.recommendation || m.reason))
      .map((m) => ({
        type: m.type || 'unknown',
        recommendation: m.recommendation || 'n/a',
        reason: m.reason || '',
      }));

    return new Response(JSON.stringify({ recommendations }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ recommendations: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
