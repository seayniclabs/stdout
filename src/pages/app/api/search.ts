import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { requireAuth } from '../../../lib/rbac';
import { validateLength, INPUT_LIMITS } from '../../../lib/validation';

// SECURITY FIX (2026-08-16): Rate limiting for search endpoint
const SEARCH_RATE_LIMIT = 30; // requests per minute
const SEARCH_WINDOW_MS = 60 * 1000;
const searchRateMap = new Map<string, number[]>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const cutoff = now - SEARCH_WINDOW_MS;
  for (const [userId, timestamps] of searchRateMap.entries()) {
    const valid = timestamps.filter(t => t > cutoff);
    if (valid.length === 0) {
      searchRateMap.delete(userId);
    } else {
      searchRateMap.set(userId, valid);
    }
  }
}, 5 * 60 * 1000);

export const GET: APIRoute = async ({ locals, url }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  // SECURITY FIX: Rate limiting
  const userId = locals.user!.id;
  const now = Date.now();
  const cutoff = now - SEARCH_WINDOW_MS;
  const timestamps = searchRateMap.get(userId) || [];
  const recentSearches = timestamps.filter(t => t > cutoff);

  if (recentSearches.length >= SEARCH_RATE_LIMIT) {
    const retryAfter = Math.ceil((recentSearches[0] + SEARCH_WINDOW_MS - now) / 1000);
    return new Response(JSON.stringify({
      error: `Too many search requests. Try again in ${retryAfter} seconds.`
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter)
      }
    });
  }

  recentSearches.push(now);
  searchRateMap.set(userId, recentSearches);

  const q = url.searchParams.get('q')?.trim();

  // SECURITY FIX: Input validation
  const validation = validateLength(q, 'Search query', 2, INPUT_LIMITS.SEARCH_QUERY_MAX);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

  const results: unknown[] = [];

  // Search incidents
  try {
    const ftsQuery = q.split(/\s+/).map(w => `"${w}"`).join(' OR ');
    const incidentRows = rawDb.prepare(`
      SELECT i.id, i.title, i.description, i.status, i.severity
      FROM incidents_fts fts
      JOIN incidents i ON i.rowid = fts.rowid
      WHERE incidents_fts MATCH ?
      ORDER BY rank LIMIT 10
    `).all(ftsQuery);

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
  } catch (e) {
    // SECURITY FIX (2026-08-16): Improved error handling - log but continue
    console.error('[search] FTS search error:', e);
  }

  // Search resolutions
  try {
    const ftsQuery = q.split(/\s+/).map(w => `"${w}"`).join(' OR ');
    const resRows = rawDb.prepare(`
      SELECT r.id, r.incident_id, r.content, i.title as incident_title
      FROM resolutions_fts fts
      JOIN resolutions r ON r.rowid = fts.rowid
      JOIN incidents i ON r.incident_id = i.id
      WHERE resolutions_fts MATCH ?
      ORDER BY rank LIMIT 10
    `).all(ftsQuery);

    for (const row of resRows) {
      results.push({
        type: 'resolution',
        incidentId: row.incident_id,
        title: row.incident_title,
        snippet: (row.content || '').substring(0, 120),
      });
    }
  } catch (e) {
    // SECURITY FIX (2026-08-16): Improved error handling - log but continue
    console.error('[search] FTS search error:', e);
  }

  // Search docs (knowledge base)
  try {
    const ftsQuery = q.split(/\s+/).map(w => `"${w}"`).join(' OR ');
    const docRows = rawDb.prepare(`
      SELECT d.id, d.title, d.content, d.type, d.source
      FROM docs_fts fts
      JOIN docs d ON d.rowid = fts.rowid
      WHERE docs_fts MATCH ?
      ORDER BY rank LIMIT 10
    `).all(ftsQuery);

    for (const row of docRows) {
      results.push({
        type: 'doc',
        docId: row.id,
        title: row.title,
        snippet: (row.content || '').substring(0, 120),
        docType: row.type,
        source: row.source || 'user',
      });
    }
  } catch (e) {
    // SECURITY FIX (2026-08-16): Improved error handling - log but continue
    console.error('[search] FTS search error:', e);
  }

  // Search stacks
  try {
    const likeQ = `%${q}%`;
    const stackRows = rawDb.prepare(`
      SELECT id, name, description
      FROM stacks
      WHERE name LIKE ? OR description LIKE ?
      LIMIT 10
    `).all(likeQ, likeQ);

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
      SELECT id, name, target, type
      FROM monitors
      WHERE name LIKE ? OR target LIKE ?
      LIMIT 10
    `).all(likeQ, likeQ);

    for (const row of monitorRows) {
      results.push({
        type: 'monitor',
        monitorId: row.id,
        title: row.name,
        snippet: row.target || row.url || '',
        monitorType: row.type || row.monitor_type,
      });
    }
  } catch { /* monitors table may vary */ }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
