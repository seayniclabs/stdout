import type { APIRoute } from 'astro';
import { getRecentEvents, getServiceEvents } from '../../../../lib/windlass';
import { requireAuth } from '../../../../lib/rbac';

/**
 * GET /app/api/windlass/events
 * List recent events, optionally filtered by service.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  const userId = locals.workspace?.ownerId || locals.user.id;
  const serviceId = url.searchParams.get('serviceId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  const events = serviceId
    ? getServiceEvents(serviceId, limit)
    : getRecentEvents(userId, limit);

  return new Response(JSON.stringify({ events }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
