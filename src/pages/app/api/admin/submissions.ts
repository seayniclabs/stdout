import type { APIRoute } from 'astro';
import { getCentralDb, centralSchema } from '../../../../lib/db';
import { eq, desc } from 'drizzle-orm';

/**
 * Community submission moderation queue (F007 — admin review).
 *
 *   GET  /app/api/admin/submissions?status=pending   → list submissions for review
 *   POST /app/api/admin/submissions                  → { id, decision: 'publish'|'reject', notes? }
 *
 * Submissions arrive already sanitized + accuracy/appropriateness-screened (contribute.ts). This is
 * the human gate on top: an admin (manage_settings) publishes or rejects, with optional notes. The
 * sanitized content is shown so the reviewer sees exactly what would go public.
 */

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const { checkRBAC } = await import('../../../../lib/rbac');
  const block = checkRBAC(locals, 'manage_settings');
  if (block) return block;

  const status = url.searchParams.get('status') || 'pending';
  const db = getCentralDb();
  const rows = db.select().from(centralSchema.communitySubmissions)
    .where(eq(centralSchema.communitySubmissions.status, status as any))
    .orderBy(desc(centralSchema.communitySubmissions.createdAt))
    .all();

  return json({ submissions: rows });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const { checkRBAC } = await import('../../../../lib/rbac');
  const block = checkRBAC(locals, 'manage_settings');
  if (block) return block;

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { id, decision, notes } = body || {};
  if (!id || (decision !== 'publish' && decision !== 'reject')) {
    return json({ error: "id and decision ('publish'|'reject') are required" }, 400);
  }

  const db = getCentralDb();
  const sub = db.select().from(centralSchema.communitySubmissions)
    .where(eq(centralSchema.communitySubmissions.id, id)).get();
  if (!sub) return json({ error: 'Submission not found' }, 404);
  if (sub.status !== 'pending') return json({ error: `Already ${sub.status}` }, 409);

  const now = new Date();
  const newStatus = decision === 'publish' ? 'published' : 'rejected';
  db.update(centralSchema.communitySubmissions)
    .set({
      status: newStatus,
      reviewNotes: (notes || '').slice(0, 1000) || null,
      updatedAt: now,
      ...(decision === 'publish' ? { publishedAt: now } : {}),
    })
    .where(eq(centralSchema.communitySubmissions.id, id))
    .run();

  return json({ ok: true, id, status: newStatus });
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
