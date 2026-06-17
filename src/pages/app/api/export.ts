import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { eq, inArray } from 'drizzle-orm';
import { logAudit, getClientIp } from '../../../lib/audit';

export const GET: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'export_data');
  if (rbacBlock) return rbacBlock;

  const db = getDb();

  const stacks = db.select().from(schema.stacks)
    .where(eq(schema.stacks.userId, locals.user.id)).all();

  const incidents = db.select().from(schema.incidents)
    .where(eq(schema.incidents.userId, locals.user.id)).all();

  const resolutions = db.select().from(schema.resolutions)
    .where(eq(schema.resolutions.userId, locals.user.id)).all();

  const userIncidentIds = incidents.map(i => i.id);
  const diagnoses = userIncidentIds.length > 0
    ? db.select().from(schema.diagnoses)
        .where(inArray(schema.diagnoses.incidentId, userIncidentIds)).all()
    : [];

  const docs = db.select().from(schema.docs)
    .where(eq(schema.docs.userId, locals.user.id)).all();

  const exportData = {
    exportedAt: new Date().toISOString(),
    user: {
      id: locals.user.id,
      email: locals.user.email,
      displayName: locals.user.displayName,
    },
    stacks,
    incidents,
    resolutions,
    diagnoses,
    docs,
  };

  logAudit('data_export', {
    userId: locals.user.id,
    ip: getClientIp(request),
    details: {
      stacks: stacks.length,
      incidents: incidents.length,
      resolutions: resolutions.length,
      diagnoses: diagnoses.length,
      docs: docs.length,
    },
  });

  const filename = `stdout-export-${new Date().toISOString().split('T')[0]}.json`;

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
