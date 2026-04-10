import type { APIRoute } from 'astro';
import { eq, and } from 'drizzle-orm';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { checkRBAC, getWorkspaceOwnerId } from '../../../../lib/rbac';

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
  const workspaceOwnerId = getWorkspaceOwnerId(locals);
  const allowedStackUserIds = new Set([locals.user.id, workspaceOwnerId]);

  // Validate both stacks belong to this workspace (owner and/or current member rows)
  const source = db.select().from(tenantSchema.stacks).where(eq(tenantSchema.stacks.id, sourceId)).get();
  const target = db.select().from(tenantSchema.stacks).where(eq(tenantSchema.stacks.id, targetId)).get();

  if (!source || !allowedStackUserIds.has(source.userId)) {
    return new Response(JSON.stringify({ error: 'Source stack not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!target || !allowedStackUserIds.has(target.userId)) {
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

  // Scope mutations by each row's owner userId (team workspace: stacks may belong to workspace owner)
  db.update(tenantSchema.stacks).set({
    description: mergedDescription,
    previousDescription: target.description, // allow undo
    updatedAt: new Date(),
  }).where(and(
    eq(tenantSchema.stacks.id, targetId),
    eq(tenantSchema.stacks.userId, target.userId),
  )).run();

  db.update(tenantSchema.incidents).set({
    stackId: targetId,
  }).where(and(
    eq(tenantSchema.incidents.stackId, sourceId),
    eq(tenantSchema.incidents.userId, source.userId),
  )).run();

  db.update(tenantSchema.docs).set({
    stackId: targetId,
  }).where(and(
    eq(tenantSchema.docs.stackId, sourceId),
    eq(tenantSchema.docs.userId, source.userId),
  )).run();

  db.delete(tenantSchema.stacks).where(and(
    eq(tenantSchema.stacks.id, sourceId),
    eq(tenantSchema.stacks.userId, source.userId),
  )).run();

  return new Response(JSON.stringify({ ok: true, targetId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
