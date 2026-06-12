import { nanoid } from 'nanoid';
import { getCentralDb, centralSchema } from './db';

export type AuditAction =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'register'
  | 'password_reset_request'
  | 'password_reset'
  | 'ai_diagnosis'
  | 'backup_create'
  | 'backup_restore'
  | 'data_export'
  | 'account_delete'
  | 'token_create'
  | 'token_revoke'
  | 'satellite_node_register'
  | 'satellite_node_deregister'
  | 'team_invite'
  | 'team_role_update'
  | 'team_remove';

/**
 * Log an auditable event to the central database.
 * Called from route handlers after sensitive operations.
 */
export function logAudit(
  action: AuditAction,
  opts: {
    userId?: string | null;
    ip?: string;
    details?: Record<string, unknown>;
  } = {}
): void {
  try {
    getCentralDb().insert(centralSchema.auditLog).values({
      id: nanoid(),
      userId: opts.userId || null,
      action,
      details: opts.details ? JSON.stringify(opts.details) : null,
      ip: opts.ip || null,
      createdAt: new Date(),
    }).run();
  } catch {
    // Audit logging should never break the request
    console.error(`Audit log failed: ${action}`);
  }
}

/**
 * Extract client IP from request headers.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
