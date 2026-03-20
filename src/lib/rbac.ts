// RBAC for Shop tier — team workspace access control.
//
// Model:
// - Owner: the account holder (Shop subscriber). Implicit role, not stored in team_members.
// - Members: invited via email, stored in team_members with a role.
// - Roles: admin (full write), editor (create/edit), viewer (read-only)
//
// When a team member accesses the workspace, they use the owner's tenant DB.
// The session tracks which workspace the user is currently viewing.

import { getCentralDb, centralSchema, getTenantDb } from './db';
import { eq, and } from 'drizzle-orm';
import { getUserLimits } from './tiers';
import type { SessionUser } from './auth';

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface WorkspaceContext {
  ownerId: string;      // whose tenant DB to use
  role: TeamRole;        // the current user's role in this workspace
  isOwnWorkspace: boolean;
}

/**
 * Get the workspace context for a user.
 * If workspaceId is provided, resolves team membership.
 * Otherwise, returns the user's own workspace.
 */
export function getWorkspaceContext(user: SessionUser, workspaceId?: string): WorkspaceContext {
  // Own workspace
  if (!workspaceId || workspaceId === user.id) {
    return { ownerId: user.id, role: 'owner', isOwnWorkspace: true };
  }

  // Team workspace — check membership
  const db = getCentralDb();
  const membership = db.select().from(centralSchema.teamMembers)
    .where(and(
      eq(centralSchema.teamMembers.ownerId, workspaceId),
      eq(centralSchema.teamMembers.userId, user.id),
      eq(centralSchema.teamMembers.status, 'accepted'),
    ))
    .get();

  if (!membership) {
    // Not a member — fall back to own workspace
    return { ownerId: user.id, role: 'owner', isOwnWorkspace: true };
  }

  return {
    ownerId: workspaceId,
    role: membership.role as TeamRole,
    isOwnWorkspace: false,
  };
}

/**
 * Check if a role can perform a given action.
 */
export function canPerform(role: TeamRole, action: RBACAction): boolean {
  return ROLE_PERMISSIONS[role]?.includes(action) ?? false;
}

export type RBACAction =
  | 'read'           // view stacks, incidents, docs, monitors
  | 'create'         // create incidents, docs, resolutions
  | 'edit'           // edit incidents, docs, stacks
  | 'delete'         // delete incidents, docs, stacks
  | 'manage_team'    // invite/remove team members, change roles
  | 'manage_settings' // branding, notifications, scanner, billing
  | 'manage_monitors' // create/edit/delete monitors, status pages
  | 'create_backup'   // create/restore backups
  | 'export_data'     // export account data

const ROLE_PERMISSIONS: Record<TeamRole, RBACAction[]> = {
  owner: ['read', 'create', 'edit', 'delete', 'manage_team', 'manage_settings', 'manage_monitors', 'create_backup', 'export_data'],
  admin: ['read', 'create', 'edit', 'delete', 'manage_team', 'manage_settings', 'manage_monitors', 'create_backup', 'export_data'],
  editor: ['read', 'create', 'edit', 'manage_monitors'],
  viewer: ['read'],
};

/**
 * Get all team members for an owner.
 */
export function getTeamMembers(ownerId: string) {
  const db = getCentralDb();
  return db.select().from(centralSchema.teamMembers)
    .where(eq(centralSchema.teamMembers.ownerId, ownerId))
    .all();
}

/**
 * Get all workspaces a user has access to (their own + any teams they're on).
 */
export function getUserWorkspaces(userId: string) {
  const db = getCentralDb();

  // Own workspace is always available
  const own = db.select({
    id: centralSchema.users.id,
    displayName: centralSchema.users.displayName,
    email: centralSchema.users.email,
  }).from(centralSchema.users)
    .where(eq(centralSchema.users.id, userId))
    .get();

  // Team workspaces
  const memberships = db.select({
    ownerId: centralSchema.teamMembers.ownerId,
    role: centralSchema.teamMembers.role,
    ownerName: centralSchema.users.displayName,
    ownerEmail: centralSchema.users.email,
  }).from(centralSchema.teamMembers)
    .innerJoin(centralSchema.users, eq(centralSchema.teamMembers.ownerId, centralSchema.users.id))
    .where(and(
      eq(centralSchema.teamMembers.userId, userId),
      eq(centralSchema.teamMembers.status, 'accepted'),
    ))
    .all();

  return {
    own: own ? { id: own.id, name: own.displayName || own.email, role: 'owner' as const } : null,
    teams: memberships.map(m => ({
      id: m.ownerId,
      name: m.ownerName || m.ownerEmail,
      role: m.role as TeamRole,
    })),
  };
}

/**
 * JSON 403 response for RBAC violations.
 */
export function rbacBlockedResponse(action: RBACAction, role: TeamRole): Response {
  return new Response(JSON.stringify({
    error: `${role} role cannot ${action}`,
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Get the tenant DB owner ID for the current workspace.
 * In team workspaces, this returns the owner's ID (not the current user's).
 * In own workspaces (or when no workspace context), returns the user's own ID.
 */
export function getWorkspaceOwnerId(locals: App.Locals): string {
  if (locals.workspace && !locals.workspace.isOwnWorkspace) {
    return locals.workspace.ownerId;
  }
  return locals.user!.id;
}

/**
 * Check RBAC for an API route. Returns a 403 Response if blocked, null if allowed.
 * Usage: const blocked = checkRBAC(locals, 'create'); if (blocked) return blocked;
 */
export function checkRBAC(locals: App.Locals, action: RBACAction): Response | null {
  if (!locals.workspace) return null; // no workspace = own workspace, always allowed
  if (locals.workspace.isOwnWorkspace) return null; // owner always allowed
  if (canPerform(locals.workspace.role, action)) return null;
  return rbacBlockedResponse(action, locals.workspace.role);
}
