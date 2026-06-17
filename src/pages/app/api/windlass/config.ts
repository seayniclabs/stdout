import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { getConfig } from '../../../../lib/windlass';

/**
 * GET /app/api/windlass/config
 * Get the user's Windlass configuration.
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const config = getConfig(userId);

  return new Response(JSON.stringify({ config: config || null }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * POST /app/api/windlass/config
 * Create or update Windlass configuration.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const { endpointUrl, syncIntervalSeconds, enabled } = body;

  if (!endpointUrl) {
    return new Response(JSON.stringify({ error: 'endpointUrl is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate URL format
  try {
    new URL(endpointUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
  const existing = getConfig(userId);
  const now = new Date();

  if (existing) {
    db.update(schema.windlassConfig)
      .set({
        endpointUrl,
        syncIntervalSeconds: syncIntervalSeconds || 60,
        enabled: enabled !== false,
        updatedAt: now,
      })
      .where(eq(schema.windlassConfig.userId, userId))
      .run();
  } else {
    db.insert(schema.windlassConfig).values({
      id: nanoid(),
      userId,
      endpointUrl,
      syncIntervalSeconds: syncIntervalSeconds || 60,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  const config = getConfig(userId);
  return new Response(JSON.stringify({ config }), {
    status: existing ? 200 : 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
