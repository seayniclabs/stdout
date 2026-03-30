import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { getAllServices, getService, syncFromEndpoint, controlService } from '../../../../lib/windlass';

/**
 * GET /app/api/windlass/services
 * List all services or get a single service by ?id=
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const serviceId = url.searchParams.get('id');
  const userId = locals.workspace?.ownerId || locals.user.id;

  if (serviceId) {
    const service = getService(userId, serviceId);
    if (!service) {
      return new Response(JSON.stringify({ error: 'Service not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ service }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const services = getAllServices(userId);
  return new Response(JSON.stringify({ services }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * POST /app/api/windlass/services
 * Actions: sync, control
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const action = body.action;

  if (action === 'sync') {
    try {
      const result = await syncFromEndpoint(userId);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (action === 'control') {
    const { serviceId, command } = body;
    if (!serviceId || !['start', 'stop', 'restart'].includes(command)) {
      return new Response(JSON.stringify({ error: 'serviceId and command (start|stop|restart) required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      await controlService(userId, serviceId, command);
      return new Response(JSON.stringify({ ok: true, serviceId, command }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
