import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/rbac';

const { userSkinPreferences } = schema;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  try {
    const body = await request.json();
    const { skinId } = body;

    // CSRF check
    const { validateCsrf } = await import('../../../../middleware');
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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
        .where(eq(userSkinPreferences.userId, locals.user.id));
    } else {
      // Create new preference row
      await db.insert(userSkinPreferences).values({
        userId: locals.user.id,
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
        error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Failed to save skin preference',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
