import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { getUserLimits } from '../../../lib/tiers';
import { checkRBAC, getTeamMembers, getWorkspaceOwnerId } from '../../../lib/rbac';
import { logAudit, getClientIp } from '../../../lib/audit';

export const prerender = false;

// GET — list team members for the active workspace (owner roster when viewing a team workspace)
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const workspaceOwnerId = getWorkspaceOwnerId(locals);
  const members = getTeamMembers(workspaceOwnerId);

  return new Response(JSON.stringify({ members }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST — invite, update role, or remove team member
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const workspaceOwnerId = getWorkspaceOwnerId(locals);
  const teamBlock = checkRBAC(locals, 'manage_team');
  if (teamBlock) return teamBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const action = body.action;
  const db = getDb();

  if (action === 'invite') {
    const email = (body.email || '').trim().toLowerCase();
    const role = body.role || 'viewer';

    if (!email || !['admin', 'editor', 'viewer'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Valid email and role (admin/editor/viewer) required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (email === locals.user.email) {
      return new Response(JSON.stringify({ error: 'Cannot invite yourself' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check seat limit
    const { limits } = getUserLimits(locals.user);
    const tier = limits.aiModel === 'sonnet' ? 'paid' : 'free';
    const existing = getTeamMembers(workspaceOwnerId);
    const activeCount = existing.filter(m => m.status !== 'revoked').length;
    if (activeCount >= limits.maxSeats - 1) { // -1 because owner counts as a seat
      return new Response(JSON.stringify({ error: `Seat limit reached (${limits.maxSeats} on ${tier} plan)` }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if already invited
    const alreadyInvited = existing.find(m => m.email === email && m.status !== 'revoked');
    if (alreadyInvited) {
      return new Response(JSON.stringify({ error: 'This email has already been invited' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the invitee has a StdOut account
    const invitee = db.select().from(schema.users).where(eq(schema.users.email, email)).get();

    const id = nanoid();
    const now = new Date();

    db.insert(schema.teamMembers).values({
      id,
      ownerId: workspaceOwnerId,
      userId: invitee?.id || null,
      email,
      role,
      status: invitee ? 'accepted' : 'pending', // auto-accept if user exists
      invitedAt: now,
      acceptedAt: invitee ? now : null,
    }).run();

    logAudit('team_invite', {
      userId: locals.user.id,
      ip: getClientIp(request),
      details: { email, role, autoAccepted: !!invitee },
    });

    return new Response(JSON.stringify({
      id,
      email,
      role,
      status: invitee ? 'accepted' : 'pending',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'update_role') {
    const memberId = body.memberId;
    const newRole = body.role;

    if (!memberId || !['admin', 'editor', 'viewer'].includes(newRole)) {
      return new Response(JSON.stringify({ error: 'memberId and valid role required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const member = db.select().from(schema.teamMembers)
      .where(and(
        eq(schema.teamMembers.id, memberId),
        eq(schema.teamMembers.ownerId, workspaceOwnerId),
      )).get();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    db.update(schema.teamMembers)
      .set({ role: newRole })
      .where(and(
        eq(schema.teamMembers.id, memberId),
        eq(schema.teamMembers.ownerId, workspaceOwnerId),
      ))
      .run();

    logAudit('team_role_update', {
      userId: locals.user.id,
      ip: getClientIp(request),
      details: { memberId, email: member.email, oldRole: member.role, newRole },
    });

    return new Response(JSON.stringify({ updated: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'remove') {
    const memberId = body.memberId;

    if (!memberId) {
      return new Response(JSON.stringify({ error: 'memberId required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const member = db.select().from(schema.teamMembers)
      .where(and(
        eq(schema.teamMembers.id, memberId),
        eq(schema.teamMembers.ownerId, workspaceOwnerId),
      )).get();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    db.update(schema.teamMembers)
      .set({ status: 'revoked' })
      .where(and(
        eq(schema.teamMembers.id, memberId),
        eq(schema.teamMembers.ownerId, workspaceOwnerId),
      ))
      .run();

    logAudit('team_remove', {
      userId: locals.user.id,
      ip: getClientIp(request),
      details: { memberId, email: member.email },
    });

    return new Response(JSON.stringify({ removed: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
