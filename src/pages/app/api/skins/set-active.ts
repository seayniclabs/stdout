import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../lib/db';

const { userSkinPreferences } = schema;

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { skinId } = body;

    if (!skinId || typeof skinId !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid skin ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    const now = new Date();

    // Check if user preference row exists
    const existing = await db
      .select()
      .from(userSkinPreferences)
      .where(eq(userSkinPreferences.userId, session.id))
      .limit(1);

    if (existing.length > 0) {
      // Update existing preference
      await db
        .update(userSkinPreferences)
        .set({
          activeSkinId: skinId,
          updatedAt: now,
        })
        .where(eq(userSkinPreferences.userId, session.id));
    } else {
      // Create new preference row
      await db.insert(userSkinPreferences).values({
        userId: session.id,
        activeSkinId: skinId,
        customOverrides: null,
        updatedAt: now,
      });
    }

    return new Response(
      JSON.stringify({ success: true, skinId }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[skins/set-active] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to save skin preference',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
