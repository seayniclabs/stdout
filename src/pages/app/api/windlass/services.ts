import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { getAllServices, getService, syncFromEndpoint, controlService } from '../../../../lib/windlass';
import { requireAuth } from '../../../../lib/rbac';

/**
 * GET /app/api/windlass/services
 * List all services or get a single service by ?id=
 */
export const GET: APIRoute = async ({ locals, url }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

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
 * Actions: sync, control, override, suggest_schedule
 */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - manage_settings covers all Windlass service management
  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const action = body.action;

  if (action === 'sync') {
    try {
      const result = await syncFromEndpoint(userId);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
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
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (action === 'override') {
    const { serviceId, duration, reason } = body;
    if (!serviceId) {
      return new Response(JSON.stringify({ error: 'serviceId is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    const service = getService(userId, serviceId);
    if (!service) {
      return new Response(JSON.stringify({ error: 'Service not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    // duration in minutes (0 = clear override, null/undefined = until next schedule eval)
    let overrideUntil: Date | null = null;
    if (duration === 0 || duration === 'clear') {
      overrideUntil = null; // Clear the override
    } else {
      const mins = parseInt(duration) || 60; // Default 1 hour
      overrideUntil = new Date(Date.now() + mins * 60 * 1000);
    }

    db.update(schema.windlassServices)
      .set({
        overrideUntil,
        overrideReason: overrideUntil ? (reason || `Manual override for ${duration || 60} minutes`) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.windlassServices.id, serviceId), eq(schema.windlassServices.userId, userId)))
      .run();

    const { logEvent } = await import('../../../../lib/windlass');
    logEvent(userId, serviceId, overrideUntil ? 'config_changed' : 'config_changed',
      overrideUntil ? `Override set until ${overrideUntil.toISOString()} — ${reason || 'manual'}` : 'Override cleared');

    return new Response(JSON.stringify({ ok: true, overrideUntil }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'suggest_schedule') {
    const { serviceId, runtimeWindowStart, runtimeWindowEnd } = body;
    if (!serviceId || !runtimeWindowStart || !runtimeWindowEnd) {
      return new Response(JSON.stringify({ error: 'serviceId, runtimeWindowStart, and runtimeWindowEnd are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    const service = getService(userId, serviceId);
    if (!service) {
      return new Response(JSON.stringify({ error: 'Service not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    db.update(schema.windlassServices)
      .set({
        serviceType: 'schedule',
        classification: 'scheduled',
        runtimeWindowStart,
        runtimeWindowEnd,
        schedulingSuggestion: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.windlassServices.id, serviceId), eq(schema.windlassServices.userId, userId)))
      .run();

    const { logEvent } = await import('../../../../lib/windlass');
    logEvent(
      userId,
      serviceId,
      'config_changed',
      `Schedule suggested and applied: ${runtimeWindowStart}-${runtimeWindowEnd}`,
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
