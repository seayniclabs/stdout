import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../lib/db';
import { generateScheduleYamlFromScan } from '../../../../lib/windlass-schedule';
import { requireAuth } from '../../../../lib/rbac';

export const POST: APIRoute = async ({ locals, cookies, request }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token');
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const ownerId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();

  const imports = db.select().from(schema.stackImports)
    .where(eq(schema.stackImports.status, 'confirmed'))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const latest = imports[0];
  if (!latest) {
    return new Response(JSON.stringify({ error: 'No confirmed scanner import found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const yaml = generateScheduleYamlFromScan(latest.rawJson);
  if (!yaml) {
    return new Response(JSON.stringify({ error: 'Could not generate schedule from import data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ yaml }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
