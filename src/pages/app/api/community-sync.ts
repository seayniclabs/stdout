import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { eq, gt, and } from 'drizzle-orm';
import { syncCommunityLibrary } from '../../../lib/community-kb';
import { requireAuth } from '../../../lib/rbac';

/**
 * GET /app/api/community-sync?since_version=0
 *
 * Returns published community docs newer than the given version.
 * Used by SaaS tenants (periodic sync) and self-hosted instances (update check).
 *
 * No auth required — community docs are public. The content is already sanitized.
 * Rate-limited by the general middleware.
 */
export const GET: APIRoute = async ({ url }) => {
  const sinceVersion = parseInt(url.searchParams.get('since_version') || '0', 10) || 0;

  const centralDb = getDb();

  // Get published submissions with version > sinceVersion
  const published = centralDb.select().from(schema.communitySubmissions)
    .where(and(
      eq(schema.communitySubmissions.status, 'published'),
      gt(schema.communitySubmissions.version, sinceVersion),
    ))
    .all();

  // Get withdrawn submissions (so clients can remove them locally)
  const withdrawn = centralDb.select({
    id: schema.communitySubmissions.id,
  }).from(schema.communitySubmissions)
    .where(eq(schema.communitySubmissions.status, 'withdrawn'))
    .all();

  const docs = published.map(sub => ({
    id: sub.id,
    title: sub.sanitizedTitle,
    content: sub.sanitizedContent,
    docType: sub.docType,
    tags: sub.tags,
    version: sub.version,
    publishedAt: sub.publishedAt?.getTime() || sub.updatedAt.getTime(),
  }));

  return new Response(JSON.stringify({
    docs,
    withdrawn: withdrawn.map(w => w.id),
    syncVersion: Math.max(sinceVersion, ...docs.map(d => d.version), 0),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * POST /app/api/community-sync
 *
 * Pulls new/updated community docs from stdout.seayniclabs.com/library and imports
 * them into the local docs table with source='community'. Withdrawn docs are removed.
 *
 * Auth: requires an authenticated user. Sync is scoped to that user's workspace.
 */
export const POST: APIRoute = async ({ locals, cookies, request }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  // CSRF check
  const { validateCsrf } = await import('../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token');
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const workspaceUserId = locals.workspace?.ownerId || locals.user.id;
  const summary = await syncCommunityLibrary(workspaceUserId);
  return new Response(JSON.stringify(summary), {
    status: summary.error ? 502 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
