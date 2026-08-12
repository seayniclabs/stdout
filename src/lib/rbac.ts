import type { SessionUser } from './auth';

export type Role = 'superadmin' | 'admin' | 'operator' | 'viewer';

export type RBACAction =
  | 'read' | 'create' | 'edit' | 'delete'
  | 'manage_monitors' | 'manage_settings'
  | 'configure_observatory' | 'execute_playbook';

const ROLE_PERMISSIONS: Record<Role, RBACAction[]> = {
  superadmin: ['read', 'create', 'edit', 'delete', 'manage_monitors',
               'manage_settings', 'configure_observatory', 'execute_playbook'],
  admin: ['read', 'create', 'edit', 'delete', 'manage_monitors',
          'manage_settings', 'configure_observatory', 'execute_playbook'],
  operator: ['read', 'create', 'edit', 'manage_monitors', 'execute_playbook'],
  viewer: ['read']
};

export function canPerform(role: string, action: RBACAction): boolean {
  const userRole = role as Role;
  return ROLE_PERMISSIONS[userRole]?.includes(action) ?? false;
}

function rbacBlockedResponse(action: RBACAction, role: Role): Response {
  return new Response(JSON.stringify({
    error: 'Forbidden',
    message: `Role '${role}' cannot perform action '${action}'`
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({
    error: 'Unauthorized',
    message: 'Authentication required'
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function checkRBAC(locals: App.Locals, action: RBACAction): Response | null {
  if (!locals.user) return unauthorized();
  if (!canPerform(locals.user.role, action)) {
    return rbacBlockedResponse(action, locals.user.role as Role);
  }
  return null;
}

export function requireAuth(locals: App.Locals): Response | null {
  if (!locals.user) return unauthorized();
  return null;
}
