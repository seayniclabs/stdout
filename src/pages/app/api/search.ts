import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
  const rawDb = (db as any).$client;
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
  } catch (e) { console.error('FTS search error:', e); }

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
  } catch (e) { console.error('FTS search error:', e); }

  // Search docs (user's own + community docs)
  try {
    const ftsQuery = q.split(/\s+/).map(w => `"${w}"`).join(' OR ');
    const docRows = rawDb.prepare(`
      SELECT d.id, d.title, d.content, d.doc_type, d.source
      FROM docs_fts fts
      JOIN docs d ON d.rowid = fts.rowid
      WHERE docs_fts MATCH ? AND (d.user_id = ? OR d.source = 'community')
      ORDER BY rank LIMIT 10
    `).all(ftsQuery, locals.user.id);

    for (const row of docRows) {
      results.push({
        type: 'doc',
        docId: row.id,
        title: row.title,
        snippet: (row.content || '').substring(0, 120),
        docType: row.doc_type,
        source: row.source || 'user',
      });
    }
  } catch (e) { console.error('FTS search error:', e); }

  // Search stacks
  try {
    const likeQ = `%${q}%`;
    const stackRows = rawDb.prepare(`
      SELECT id, name, description
      FROM stacks
      WHERE user_id = ? AND (name LIKE ? OR description LIKE ?)
      LIMIT 10
    `).all(locals.user.id, likeQ, likeQ);

    for (const row of stackRows) {
      results.push({
        type: 'stack',
        stackId: row.id,
        title: row.name,
        snippet: (row.description || '').substring(0, 120),
      });
    }
  } catch { /* stacks table may not have description column */ }

  // Search monitors
  try {
    const likeQ = `%${q}%`;
    const monitorRows = rawDb.prepare(`
      SELECT id, name, url, monitor_type
      FROM monitors
      WHERE user_id = ? AND (name LIKE ? OR url LIKE ?)
      LIMIT 10
    `).all(locals.user.id, likeQ, likeQ);

    for (const row of monitorRows) {
      results.push({
        type: 'monitor',
        monitorId: row.id,
        title: row.name,
        snippet: row.url || '',
        monitorType: row.monitor_type,
      });
    }
  } catch { /* monitors table may vary */ }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
