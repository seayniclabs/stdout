import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/rbac';

// POST /app/api/addons/dismiss — dismiss the add-ons banner for this session
export const POST: APIRoute = async ({ locals, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = cookies.get('csrf_token')?.value;
  if (!validateCsrf(csrfToken, cookies)) {
    return Response.json({ error: 'CSRF token validation failed' }, { status: 403 });
  }

  const db = getDb();

  db.update(schema.systemSettings)
    .set({ addonsDismissed: true })
    .run();

  return Response.json({ ok: true });
};
