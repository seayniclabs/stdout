import type { APIRoute } from 'astro';
import { getTenantDb, getCentralDb, tenantSchema, centralSchema } from '../../../lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { sanitizeForCommunity } from '../../../lib/sanitize';
import { scoreSubmission } from '../../../lib/value-score';

/**
 * POST /app/api/contribute
 * Sanitizes a user doc for community contribution.
 * Returns the sanitized preview for user review.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: { docId: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.docId) {
    return new Response(JSON.stringify({ error: 'docId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getTenantDb(locals.workspace?.ownerId || locals.user!.id);
  const doc = db.select().from(tenantSchema.docs).where(eq(tenantSchema.docs.id, body.docId)).get();

  if (!doc || doc.userId !== locals.user.id) {
    return new Response(JSON.stringify({ error: 'Document not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (doc.source !== 'user') {
    return new Response(JSON.stringify({ error: 'Only user-created docs can be contributed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await sanitizeForCommunity({
      title: doc.title,
      content: doc.content,
    });

    return new Response(JSON.stringify({
      original: { title: doc.title, content: doc.content },
      sanitized: {
        title: result.sanitizedTitle,
        content: result.sanitizedContent,
      },
      replacements: result.replacements,
      flagged: result.flagged,
      flagReason: result.flagReason,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Sanitization failed:', err);
    return new Response(JSON.stringify({ error: 'Sanitization failed. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * PUT /app/api/contribute
 * Confirms a contribution — saves sanitized doc to central community_submissions.
 * Runs value scoring before accepting.
 */
export const PUT: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: {
    docId: string;
    sanitizedTitle: string;
    sanitizedContent: string;
    replacements: any[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.docId || !body.sanitizedTitle || !body.sanitizedContent) {
    return new Response(JSON.stringify({ error: 'docId, sanitizedTitle, and sanitizedContent required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the source doc exists and belongs to this user
  const db = getTenantDb(locals.workspace?.ownerId || locals.user!.id);
  const doc = db.select().from(tenantSchema.docs).where(eq(tenantSchema.docs.id, body.docId)).get();

  if (!doc || doc.userId !== locals.user.id || doc.source !== 'user') {
    return new Response(JSON.stringify({ error: 'Document not found or not eligible' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Run value scoring
  const score = scoreSubmission({
    title: body.sanitizedTitle,
    content: body.sanitizedContent,
    docType: doc.docType,
  });

  if (!score.passed) {
    return new Response(JSON.stringify({
      error: 'Submission did not meet quality threshold',
      score: score.score,
      reasons: score.reasons,
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Save to central DB
  const centralDb = getCentralDb();
  const submissionId = nanoid();
  const now = new Date();

  centralDb.insert(centralSchema.communitySubmissions).values({
    id: submissionId,
    userId: locals.user.id,
    originalDocId: body.docId,
    sanitizedTitle: body.sanitizedTitle,
    sanitizedContent: body.sanitizedContent,
    docType: doc.docType,
    tags: doc.tags,
    sanitizationLog: JSON.stringify(body.replacements || []),
    valueScore: score.score,
    status: 'pending',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }).run();

  return new Response(JSON.stringify({
    submissionId,
    score: score.score,
    status: 'pending',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * DELETE /app/api/contribute
 * Withdraw a previously submitted contribution.
 */
export const DELETE: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: { submissionId: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.submissionId) {
    return new Response(JSON.stringify({ error: 'submissionId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const centralDb = getCentralDb();
  const submission = centralDb.select().from(centralSchema.communitySubmissions)
    .where(eq(centralSchema.communitySubmissions.id, body.submissionId)).get();

  if (!submission || submission.userId !== locals.user.id) {
    return new Response(JSON.stringify({ error: 'Submission not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mark as withdrawn (don't delete — audit trail)
  centralDb.update(centralSchema.communitySubmissions).set({
    status: 'withdrawn',
    updatedAt: new Date(),
  }).where(eq(centralSchema.communitySubmissions.id, body.submissionId)).run();

  return new Response(JSON.stringify({ status: 'withdrawn' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
