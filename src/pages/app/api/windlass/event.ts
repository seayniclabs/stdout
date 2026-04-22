import type { APIRoute } from 'astro';
import { fireAlert } from '../../../../lib/alert-router';

const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);

/**
 * POST /app/api/windlass/event
 * Bearer-token-authenticated ingest endpoint for external systems (n8n, scripts).
 * Accepts an event, evaluates suppression rules, and dispatches to alert channels.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { eventType, severity, title, detail, serviceId } = body;

  if (!eventType || !severity || !title) {
    return new Response(JSON.stringify({ error: 'eventType, severity, and title are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!VALID_SEVERITIES.has(severity)) {
    return new Response(JSON.stringify({ error: 'severity must be info, warning, or critical' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await fireAlert({
    userId: locals.user.id,
    serviceId: serviceId ?? null,
    eventType,
    severity,
    title,
    detail,
  });

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};
