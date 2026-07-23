import type { APIRoute } from 'astro';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../../../../lib/db';
import { requireAuth, checkRBAC, getWorkspaceOwnerId } from '../../../../lib/rbac';

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

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

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { sourceId, targetId } = body;
  if (!sourceId || !targetId || sourceId === targetId) {
    return new Response(JSON.stringify({ error: 'sourceId and targetId are required and must differ' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();
  const workspaceOwnerId = getWorkspaceOwnerId(locals);
  const allowedStackUserIds = new Set([locals.user.id, workspaceOwnerId]);

  // Validate both stacks belong to this workspace (owner and/or current member rows)
  const source = db.select().from(schema.stacks).where(eq(schema.stacks.id, sourceId)).get();
  const target = db.select().from(schema.stacks).where(eq(schema.stacks.id, targetId)).get();

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
  db.update(schema.stacks).set({
    description: mergedDescription,
    previousDescription: target.description, // allow undo
    updatedAt: new Date(),
  }).where(and(
    eq(schema.stacks.id, targetId),
    eq(schema.stacks.userId, target.userId),
  )).run();

  db.update(schema.incidents).set({
    stackId: targetId,
  }).where(and(
    eq(schema.incidents.stackId, sourceId),
    eq(schema.incidents.userId, source.userId),
  )).run();

  db.update(schema.docs).set({
    stackId: targetId,
  }).where(and(
    eq(schema.docs.stackId, sourceId),
    eq(schema.docs.userId, source.userId),
  )).run();

  db.delete(schema.stacks).where(and(
    eq(schema.stacks.id, sourceId),
    eq(schema.stacks.userId, source.userId),
  )).run();

  return new Response(JSON.stringify({ ok: true, targetId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
