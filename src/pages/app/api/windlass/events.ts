import type { APIRoute } from 'astro';
import { getRecentEvents, getServiceEvents } from '../../../../lib/windlass';

/**
 * GET /app/api/windlass/events
 * List recent events, optionally filtered by service.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const serviceId = url.searchParams.get('serviceId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  const events = serviceId
    ? getServiceEvents(userId, serviceId, limit)
    : getRecentEvents(userId, limit);

  return new Response(JSON.stringify({ events }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
