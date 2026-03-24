import type { APIRoute } from 'astro';
import { getCentralDb, centralSchema } from '../../../lib/db';
import { eq, gt, and } from 'drizzle-orm';

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

  const centralDb = getCentralDb();

  // Get published submissions with version > sinceVersion
  const published = centralDb.select().from(centralSchema.communitySubmissions)
    .where(and(
      eq(centralSchema.communitySubmissions.status, 'published'),
      gt(centralSchema.communitySubmissions.version, sinceVersion),
    ))
    .all();

  // Get withdrawn submissions (so clients can remove them locally)
  const withdrawn = centralDb.select({
    id: centralSchema.communitySubmissions.id,
  }).from(centralSchema.communitySubmissions)
    .where(eq(centralSchema.communitySubmissions.status, 'withdrawn'))
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
