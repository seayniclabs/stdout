import type { APIRoute } from 'astro';
import {
  createChannel, listChannels, deleteChannel, toggleChannel, testChannel,
  createRule, listRules, deleteRule,
  listAlertEvents, fireAlert,
} from '../../../../lib/alert-router';

/**
 * GET /app/api/windlass/alerts
 * List channels, rules, and recent events.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.workspace?.ownerId || locals.user.id;
  const section = url.searchParams.get('section') || 'all';
  const serviceId = url.searchParams.get('serviceId') || undefined;

  const result: any = {};

  if (section === 'all' || section === 'channels') {
    result.channels = listChannels(userId);
  }
  if (section === 'all' || section === 'rules') {
    result.rules = listRules(userId);
  }
  if (section === 'all' || section === 'events') {
    result.events = listAlertEvents(userId, 50, serviceId);
  }

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * POST /app/api/windlass/alerts
 * Actions: create_channel, delete_channel, toggle_channel, test_channel,
 *          create_rule, delete_rule, fire (external event ingest)
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

  // --- Channels ---

  if (action === 'create_channel') {
    const { type, name, config } = body;
    if (!type || !name || !config) {
      return new Response(JSON.stringify({ error: 'type, name, and config are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!['email', 'telegram', 'webhook'].includes(type)) {
      return new Response(JSON.stringify({ error: 'type must be email, telegram, or webhook' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const id = createChannel(userId, type, name, config);
    return new Response(JSON.stringify({ ok: true, id }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'delete_channel') {
    const deleted = deleteChannel(userId, body.channelId);
    if (!deleted) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'toggle_channel') {
    toggleChannel(userId, body.channelId, body.enabled);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'test_channel') {
    const result = await testChannel(userId, body.channelId);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Rules ---

  if (action === 'create_rule') {
    const { channelId, serviceId, severityMin } = body;
    if (!channelId) {
      return new Response(JSON.stringify({ error: 'channelId is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const id = createRule(userId, channelId, serviceId || null, severityMin || 'warning');
    return new Response(JSON.stringify({ ok: true, id }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'delete_rule') {
    const deleted = deleteRule(userId, body.ruleId);
    if (!deleted) {
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- External event ingest ---

  if (action === 'fire') {
    const { serviceId, eventType, severity, title, detail } = body;
    if (!eventType || !severity || !title) {
      return new Response(JSON.stringify({ error: 'eventType, severity, and title are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await fireAlert({
      userId,
      serviceId: serviceId || null,
      eventType,
      severity,
      title,
      detail,
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
