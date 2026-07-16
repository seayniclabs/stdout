import type { APIRoute } from 'astro';
import { createBackup, listBackups, restoreBackup } from '../../../lib/backup';
import { logAudit, getClientIp } from '../../../lib/audit';
import { checkRBAC, getWorkspaceOwnerId } from '../../../lib/rbac';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const tenantOwnerId = getWorkspaceOwnerId(locals);
  if (tenantOwnerId !== locals.user.id) {
    const blocked = checkRBAC(locals, 'read');
    if (blocked) return blocked;
  }

  try {
    const backups = listBackups(tenantOwnerId);
    return new Response(JSON.stringify({ backups }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const rbacBlock = checkRBAC(locals, 'create_backup');
  if (rbacBlock) return rbacBlock;

  let body: any = {};
  try {
    body = await request.json();
  } catch { /* empty body is fine for create */ }

  const action = body.action || 'create';

  if (action === 'create') {
    // Tier gate: backups
    const { checkFeature, tierBlockedResponse } = await import('../../../lib/tier-gate');
    const gate = checkFeature(locals.user, 'backupsEnabled');
    if (!gate.allowed) return tierBlockedResponse(gate.error!, gate.tier);

    const tenantOwnerId = getWorkspaceOwnerId(locals);
    if (tenantOwnerId !== locals.user.id) {
      const blocked = checkRBAC(locals, 'create_backup');
      if (blocked) return blocked;
    }

    try {
      const backup = createBackup(tenantOwnerId);
      logAudit('backup_create', { userId: locals.user.id, ip: getClientIp(request), details: { filename: backup.filename } });
      return new Response(JSON.stringify({ backup }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (action === 'restore') {
    const filename = body.filename;
    if (!filename || typeof filename !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing filename' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tenantOwnerId = getWorkspaceOwnerId(locals);
    if (tenantOwnerId !== locals.user.id) {
      const blocked = checkRBAC(locals, 'create_backup');
      if (blocked) return blocked;
    }

    try {
      restoreBackup(tenantOwnerId, filename);
      logAudit('backup_restore', { userId: locals.user.id, ip: getClientIp(request), details: { filename } });
      return new Response(JSON.stringify({ restored: true, filename }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};
