import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { eq } from 'drizzle-orm';
import { requireAuth, checkRBAC } from '../../../lib/rbac';
import { validateCsrf } from '../../../middleware';

export const GET: APIRoute = async ({ locals }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // Team management not implemented for self-hosted single-user mode
  // Return empty array to prevent UI errors
  return new Response(JSON.stringify({ members: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_team');
  if (rbacError) return rbacError;

  try {
    const body = await request.json();

    // CSRF check
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
    }
    const { email, role } = body;

    if (!email || !role) {
      return new Response(JSON.stringify({ error: 'Email and role required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    const newMember = {
      email,
      role,
      invitedBy: locals.user!.id,
      invitedAt: new Date(),
      status: 'pending',
    };

    db.insert(schema.teamMembers).values(newMember).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[team] Failed to invite member:', error);
    return new Response(JSON.stringify({ error: 'Failed to invite member' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check
  const rbacError = checkRBAC(locals, 'manage_team');
  if (rbacError) return rbacError;

  try {
    const body = await request.json();

    // CSRF check
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
    }
    const { memberId } = body;

    if (!memberId) {
      return new Response(JSON.stringify({ error: 'Member ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    db.delete(schema.teamMembers).where(eq(schema.teamMembers.id, memberId)).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[team] Failed to remove member:', error);
    return new Response(JSON.stringify({ error: 'Failed to remove member' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
