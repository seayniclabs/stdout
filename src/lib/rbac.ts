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
 * SELF-HOSTED ONLY: Always returns the user's own workspace.
 * Multi-tenant/team workspace features are disabled for self-hosted deployments.
 */
export function getWorkspaceContext(user: SessionUser, workspaceId?: string): WorkspaceContext {
  // Self-hosted: always own workspace, ignore team membership
  return { ownerId: user.id, role: 'owner', isOwnWorkspace: true };
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
 * Get team members for a workspace. `ownerId` is the workspace owner’s user id
 * (same as `getWorkspaceOwnerId` for that workspace), not an arbitrary filter.
 */
export function getTeamMembers(ownerId: string) {
  const db = getDb();
  return db.select().from(schema.teamMembers)
    .where(eq(schema.teamMembers.ownerId, ownerId))
    .all();
}

/**
 * Get all workspaces a user has access to (their own + any teams they're on).
 */
export function getUserWorkspaces(userId: string) {
  const db = getDb();

  // Own workspace is always available
  const own = db.select({
    id: schema.users.id,
    displayName: schema.users.displayName,
    email: schema.users.email,
  }).from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  // Team workspaces
  const memberships = db.select({
    ownerId: schema.teamMembers.ownerId,
    role: schema.teamMembers.role,
    ownerName: schema.users.displayName,
    ownerEmail: schema.users.email,
  }).from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.teamMembers.ownerId, schema.users.id))
    .where(and(
      eq(schema.teamMembers.userId, userId),
      eq(schema.teamMembers.status, 'accepted'),
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
