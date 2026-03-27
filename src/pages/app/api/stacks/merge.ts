import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { checkRBAC } from '../../../../lib/rbac';

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const rbacBlock = checkRBAC(locals, 'edit');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { sourceId, targetId } = body;
  if (!sourceId || !targetId || sourceId === targetId) {
    return new Response(JSON.stringify({ error: 'sourceId and targetId are required and must differ' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getTenantDb(locals.workspace?.ownerId || locals.user.id);

  // Validate both stacks belong to the user
  const source = db.select().from(tenantSchema.stacks).where(eq(tenantSchema.stacks.id, sourceId)).get();
  const target = db.select().from(tenantSchema.stacks).where(eq(tenantSchema.stacks.id, targetId)).get();

  if (!source || source.userId !== locals.user.id) {
    return new Response(JSON.stringify({ error: 'Source stack not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!target || target.userId !== locals.user.id) {
    return new Response(JSON.stringify({ error: 'Target stack not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Merge descriptions: append source description to target with separator
  let mergedDescription = target.description || '';
  if (source.description) {
    if (mergedDescription) {
      mergedDescription += '\n\n---\n\n' + source.description;
    } else {
      mergedDescription = source.description;
    }
  }

  // Update target stack description
  db.update(tenantSchema.stacks).set({
    description: mergedDescription,
    previousDescription: target.description, // allow undo
    updatedAt: new Date(),
  }).where(eq(tenantSchema.stacks.id, targetId)).run();

  // Move incidents from source to target
  db.update(tenantSchema.incidents).set({
    stackId: targetId,
  }).where(eq(tenantSchema.incidents.stackId, sourceId)).run();

  // Move docs from source to target
  db.update(tenantSchema.docs).set({
    stackId: targetId,
  }).where(eq(tenantSchema.docs.stackId, sourceId)).run();

  // Delete the source stack
  db.delete(tenantSchema.stacks).where(eq(tenantSchema.stacks.id, sourceId)).run();

  return new Response(JSON.stringify({ ok: true, targetId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
