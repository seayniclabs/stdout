import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /app/api/feature-requests
 * List the current user's feature requests.
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();

  const requests = db.select({
    id: schema.featureRequests.id,
    title: schema.featureRequests.title,
    description: schema.featureRequests.description,
    category: schema.featureRequests.category,
    status: schema.featureRequests.status,
    votes: schema.featureRequests.votes,
    createdAt: schema.featureRequests.createdAt,
    updatedAt: schema.featureRequests.updatedAt,
  }).from(schema.featureRequests)
    .where(eq(schema.featureRequests.userId, locals.user.id))
    .orderBy(desc(schema.featureRequests.createdAt))
    .all();

  return new Response(JSON.stringify({ requests }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * POST /app/api/feature-requests
 * Submit a new feature request. Sends email to support@seayniclabs.com.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { title, description, category } = body;
  if (!title || !description) {
    return new Response(JSON.stringify({ error: 'title and description are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();
  const id = nanoid();
  const now = new Date();

  db.insert(schema.featureRequests).values({
    id,
    userId: locals.user.id,
    title,
    description,
    category: category || 'feature',
    status: 'open',
    votes: 1,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Send email notification to support
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      // User table is in the same DB now (no central/tenant split)
      const centralDb = db;
      const user = centralDb.select().from(schema.users)
        .where(eq(schema.users.id, locals.user.id)).get();

      const userEmail = user?.email || 'unknown';
      const userName = user?.displayName || userEmail;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'StdOut <noreply@stdout.seayniclabs.com>',
          to: 'support@seayniclabs.com',
          subject: `[Feature Request] ${title}`,
          text: `New feature request from ${userName} (${userEmail})\n\nTitle: ${title}\nCategory: ${category || 'feature'}\n\nDescription:\n${description}\n\n---\nRequest ID: ${id}\nSubmitted: ${now.toISOString()}`,
        }),
        signal: AbortSignal.timeout(10000),
      });
    }
  } catch (err) {
    console.error('Feature request email failed:', err);
    // Don't fail the request — email is best-effort
  }

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
};
