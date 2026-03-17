import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { eq } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
  const rawDb = (db as any)._.session?.client;
  if (!rawDb?.prepare) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results: any[] = [];

  // Search incidents
  try {
    const ftsQuery = q.split(/\s+/).map(w => `"${w}"`).join(' OR ');
    const incidentRows = rawDb.prepare(`
      SELECT i.id, i.title, i.description, i.status, i.severity
      FROM incidents_fts fts
      JOIN incidents i ON i.rowid = fts.rowid
      WHERE incidents_fts MATCH ? AND i.user_id = ?
      ORDER BY rank LIMIT 10
    `).all(ftsQuery, locals.user.id);

    for (const row of incidentRows) {
      results.push({
        type: 'incident',
        incidentId: row.id,
        title: row.title,
        snippet: (row.description || '').substring(0, 120),
        status: row.status,
        severity: row.severity,
      });
    }
  } catch { /* FTS may fail on complex queries */ }

  // Search resolutions
  try {
    const ftsQuery = q.split(/\s+/).map(w => `"${w}"`).join(' OR ');
    const resRows = rawDb.prepare(`
      SELECT r.id, r.incident_id, r.content, i.title as incident_title
      FROM resolutions_fts fts
      JOIN resolutions r ON r.rowid = fts.rowid
      JOIN incidents i ON r.incident_id = i.id
      WHERE resolutions_fts MATCH ? AND i.user_id = ?
      ORDER BY rank LIMIT 10
    `).all(ftsQuery, locals.user.id);

    for (const row of resRows) {
      results.push({
        type: 'resolution',
        incidentId: row.incident_id,
        title: row.incident_title,
        snippet: (row.content || '').substring(0, 120),
      });
    }
  } catch { /* FTS may fail on complex queries */ }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
