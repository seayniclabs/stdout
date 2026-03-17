import type { APIRoute } from 'astro';
import { createBackup, listBackups, restoreBackup } from '../../../lib/backup';

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
    try {
      const backup = createBackup(locals.user.id);
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
