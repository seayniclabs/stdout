import type { APIRoute } from 'astro';
import { createBackup, listBackups, restoreBackup } from '../../../lib/backup';
import { logAudit, getClientIp } from '../../../lib/audit';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  try {
    const backups = listBackups(locals.user.id);
    return new Response(JSON.stringify({ backups }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

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

    try {
      const backup = createBackup(locals.user.id);
      logAudit('backup_create', { userId: locals.user.id, ip: getClientIp(request), details: { filename: backup.filename } });
      return new Response(JSON.stringify({ backup }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
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

    try {
      restoreBackup(locals.user.id, filename);
      logAudit('backup_restore', { userId: locals.user.id, ip: getClientIp(request), details: { filename } });
      return new Response(JSON.stringify({ restored: true, filename }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
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
