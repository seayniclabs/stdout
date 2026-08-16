import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { requireAuth } from '../../../lib/rbac';

export const GET: APIRoute = async ({ locals, url }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const q = url.searchParams.get('q')?.trim();
  const excludeId = url.searchParams.get('exclude') || '';

  if (!q || q.length < 3) {
    return new Response(JSON.stringify({ matches: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
  const rawDb = (db as any).$client;
  if (!rawDb?.prepare) {
    return new Response(JSON.stringify({ matches: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const matches: any[] = [];

  // Search past incidents with resolutions (resolved incidents only)
  try {
    const ftsQuery = q.split(/\s+/).filter(w => w.length > 2).map(w => `"${w}"`).join(' OR ');
    if (!ftsQuery) {
      return new Response(JSON.stringify({ matches: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rows = rawDb.prepare(`
      SELECT i.id, i.title, i.description, i.severity, i.status, i.tags,
             r.content as resolution_content, r.created_at as resolved_date
      FROM incidents_fts fts
      JOIN incidents i ON i.rowid = fts.rowid
      LEFT JOIN resolutions r ON r.incident_id = i.id
      WHERE incidents_fts MATCH ?
        AND i.id != ?
        AND i.status = 'resolved'
        AND r.id IS NOT NULL
      ORDER BY rank
      LIMIT 5
    `).all(ftsQuery, excludeId);

    for (const row of rows) {
      matches.push({
        incidentId: row.id,
        title: row.title,
        description: (row.description || '').substring(0, 150),
        severity: row.severity,
        tags: row.tags,
        resolution: (row.resolution_content || '').substring(0, 300),
        resolvedDate: row.resolved_date,
      });
    }
  } catch { /* FTS may fail */ }

  // Also search docs (knowledge base) for relevant content
  const docs: any[] = [];
  try {
    const ftsQuery = q.split(/\s+/).filter(w => w.length > 2).map(w => `"${w}"`).join(' OR ');
    if (ftsQuery) {
      const docRows = rawDb.prepare(`
        SELECT d.id, d.title, d.content, d.type, d.source
        FROM docs_fts fts
        JOIN docs d ON d.rowid = fts.rowid
        WHERE docs_fts MATCH ? AND (d.user_id = ? OR d.source = 'community')
        ORDER BY rank LIMIT 5
      `).all(ftsQuery, locals.user.id);

      for (const row of docRows) {
        docs.push({
          docId: row.id,
          title: row.title,
          snippet: (row.content || '').substring(0, 200),
          docType: row.type,
          source: row.source || 'user',
        });
      }
    }
  } catch (e) { console.error('FTS similarity error:', e); }

  return new Response(JSON.stringify({ matches, docs }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
