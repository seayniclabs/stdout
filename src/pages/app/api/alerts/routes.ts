/**
 * Alert Routes API
 *
 * GET /app/api/alerts/routes - List all routes
 * POST /app/api/alerts/routes - Create route
 * PUT /app/api/alerts/routes - Update route
 * DELETE /app/api/alerts/routes/:id - Delete route
 */

import type { APIRoute } from 'astro';
import { getAlertRoutes, upsertAlertRoute, deleteAlertRoute } from '../../../../lib/alerts/alert-router';
import { requireAuth } from '../../../../lib/rbac';

export const GET: APIRoute = async ({ locals }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  try {
    const routes = getAlertRoutes(locals.user.id);

    return new Response(JSON.stringify({ routes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to get alert routes:', error);

    return new Response(JSON.stringify({
      error: 'Failed to get routes',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  try {
    const body = await request.json();
    const { name, type, config, min_severity, enabled } = body;

    // CSRF check
    const { validateCsrf } = await import('../../../../middleware');
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validation
    if (!name || !type || !config) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name, type, config' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!['slack', 'webhook', 'discord', 'email'].includes(type)) {
      return new Response(JSON.stringify({ error: 'Invalid type. Must be: slack, webhook, discord, or email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (min_severity && !['critical', 'high', 'medium', 'low'].includes(min_severity)) {
      return new Response(JSON.stringify({ error: 'Invalid min_severity. Must be: critical, high, medium, or low' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate ID
    const id = `route_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Create route
    upsertAlertRoute({
      id,
      user_id: locals.user.id,
      name,
      type,
      config,
      enabled: enabled !== false, // Default to enabled
      min_severity: min_severity || 'medium',
    });

    return new Response(JSON.stringify({
      success: true,
      route: { id, name, type, min_severity: min_severity || 'medium', enabled: enabled !== false },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to create alert route:', error);

    return new Response(JSON.stringify({
      error: 'Failed to create route',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PUT: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  try {
    const body = await request.json();
    const { id, name, type, config, min_severity, enabled } = body;

    // CSRF check
    const { validateCsrf } = await import('../../../../middleware');
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing route ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update route (upsert handles updates)
    upsertAlertRoute({
      id,
      user_id: locals.user.id,
      name,
      type,
      config,
      enabled,
      min_severity,
    });

    return new Response(JSON.stringify({
      success: true,
      route: { id, name, type, min_severity, enabled },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to update alert route:', error);

    return new Response(JSON.stringify({
      error: 'Failed to update route',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  // CSRF check for DELETE
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token');
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing route ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    deleteAlertRoute(id, locals.user.id);

    return new Response(JSON.stringify({
      success: true,
      deleted: id,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to delete alert route:', error);

    return new Response(JSON.stringify({
      error: 'Failed to delete route',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
