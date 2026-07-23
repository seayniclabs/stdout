import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../../lib/db';
import { eq } from 'drizzle-orm';
import {
  getSystemHealth,
  getRecentIncidents,
  getSatelliteStatuses,
  getStacksSummary,
} from '../../../../../lib/comms/queries';

/**
 * Comms Webhook Inbound Endpoint
 *
 * Receives messages from external channels (Sonique, CAEL, custom integrations)
 * and routes them to appropriate query functions.
 *
 * POST /app/api/comms/inbound/webhook
 * Body: {
 *   text: string;           // The question/command
 *   channel: string;        // Channel identifier (e.g., "sonique", "cael")
 *   user_id?: string;       // Optional: override user lookup
 *   channel_id?: string;    // Optional: specific channel ID for logging
 * }
 *
 * Response: {
 *   response: string;       // Natural language answer
 *   metadata?: object;      // Structured data used to generate answer
 * }
 */

interface InboundWebhookRequest {
  text: string;
  channel: string;
  user_id?: string;
  channel_id?: string;
}

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    'Content-Type': 'application/json',
  };

  const body: InboundWebhookRequest = await request.json();
  const { text, channel, user_id, channel_id } = body;

  if (!text || !channel) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: text, channel' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Auth check: prefer session user, allow override via user_id
  const userId = user_id || locals.user?.id;

  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'User ID required (authenticate or provide user_id)' }),
      { status: 401, headers: corsHeaders }
    );
  }

  // CSRF check if session-based (skip for external with user_id override)
  if (locals.user && !user_id) {
    const { validateCsrf } = await import('../../../../../middleware');
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
        status: 403,
        headers: corsHeaders
      });
    }

    const { checkRBAC } = await import('../../../../../lib/rbac');
    const rbacBlock = checkRBAC(locals, 'create');
    if (rbacBlock) return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: corsHeaders
    });
  }

  try {
    const db = getDb();
    const now = Date.now();

    // Log inbound message
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Only log if we have a channel_id (optional for now)
    if (channel_id) {
      db.insert(schema.commsMessages).values({
        id: messageId,
        channelId: channel_id,
        direction: 'inbound',
        content: text,
        metadata: JSON.stringify({ channel }),
        timestamp: new Date(),
      }).run();
    }

    // Parse intent and route to appropriate query
    const intent = parseIntent(text);
    const { response, metadata } = await handleIntent(intent, userId);

    // Log outbound message
    if (channel_id) {
      const outMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      db.insert(schema.commsMessages).values({
        id: outMessageId,
        channelId: channel_id,
        direction: 'outbound',
        content: response,
        metadata: JSON.stringify(metadata),
        timestamp: new Date(),
      }).run();
    }

    return new Response(
      JSON.stringify({ response, metadata }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error: unknown) {
    console.error('[comms/webhook] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    },
  });
};

/**
 * Parse user intent from natural language query
 */
function parseIntent(text: string): {
  type: 'health' | 'incidents' | 'satellites' | 'stacks' | 'unknown';
  params: Record<string, any>;
} {
  const lower = text.toLowerCase();

  // Health/status queries
  if (
    lower.includes('health') ||
    lower.includes('status') ||
    lower.includes('how is') ||
    lower.includes('how are') ||
    lower.includes('running')
  ) {
    return { type: 'health', params: {} };
  }

  // Incident queries
  if (
    lower.includes('incident') ||
    lower.includes('alert') ||
    lower.includes('issue') ||
    lower.includes('problem')
  ) {
    return { type: 'incidents', params: {} };
  }

  // Satellite queries
  if (lower.includes('satellite') || lower.includes('agent')) {
    return { type: 'satellites', params: {} };
  }

  // Stack queries
  if (lower.includes('stack') || lower.includes('service')) {
    return { type: 'stacks', params: {} };
  }

  return { type: 'unknown', params: {} };
}

/**
 * Handle the parsed intent and generate a response
 */
async function handleIntent(
  intent: ReturnType<typeof parseIntent>,
  userId: string
): Promise<{ response: string; metadata: any }> {
  switch (intent.type) {
    case 'health': {
      const health = await getSystemHealth(userId);
      const response = formatHealthResponse(health);
      return { response, metadata: health };
    }

    case 'incidents': {
      const incidents = await getRecentIncidents(userId, 5);
      const response = formatIncidentsResponse(incidents);
      return { response, metadata: { incidents } };
    }

    case 'satellites': {
      const satellites = await getSatelliteStatuses(userId);
      const response = formatSatellitesResponse(satellites);
      return { response, metadata: { satellites } };
    }

    case 'stacks': {
      const stacks = await getStacksSummary(userId);
      const response = formatStacksResponse(stacks);
      return { response, metadata: stacks };
    }

    default: {
      return {
        response: "I'm not sure what you're asking about. Try asking about system health, incidents, satellites, or stacks.",
        metadata: { intent: intent.type },
      };
    }
  }
}

/**
 * Format health summary as natural language
 */
function formatHealthResponse(health: Awaited<ReturnType<typeof getSystemHealth>>): string {
  const parts: string[] = [];

  if (health.services_total === 0) {
    return 'No services are being monitored yet.';
  }

  // Overall status
  if (health.services_down > 0) {
    parts.push(`⚠️  ${health.services_down} service${health.services_down === 1 ? ' is' : 's are'} down.`);
  } else if (health.services_degraded > 0) {
    parts.push(`⚠️  ${health.services_degraded} service${health.services_degraded === 1 ? ' is' : 's are'} degraded.`);
  } else {
    parts.push(`✅ All ${health.services_healthy} services healthy.`);
  }

  // Alerts
  if (health.alerts_open > 0) {
    parts.push(`${health.alerts_open} open alert${health.alerts_open === 1 ? '' : 's'}.`);
  } else {
    parts.push('No open alerts.');
  }

  // Uptime
  if (health.uptime_pct < 100) {
    parts.push(`${health.uptime_pct}% uptime (24h).`);
  }

  // Last incident
  if (health.last_incident) {
    parts.push(`Last incident: ${health.last_incident}.`);
  }

  return parts.join(' ');
}

/**
 * Format incidents as natural language
 */
function formatIncidentsResponse(incidents: Awaited<ReturnType<typeof getRecentIncidents>>): string {
  if (incidents.length === 0) {
    return 'No incidents in the last 7 days.';
  }

  const open = incidents.filter((i) => !i.resolved);
  const resolved = incidents.filter((i) => i.resolved);

  const parts: string[] = [];

  if (open.length > 0) {
    parts.push(`${open.length} open incident${open.length === 1 ? '' : 's'}:`);
    open.slice(0, 3).forEach((inc) => {
      const stack = inc.stack_name ? ` (${inc.stack_name})` : '';
      parts.push(`- ${inc.title}${stack}`);
    });
  }

  if (resolved.length > 0 && open.length === 0) {
    parts.push(`${resolved.length} resolved incident${resolved.length === 1 ? '' : 's'} in the last 7 days.`);
  }

  return parts.join('\n');
}

/**
 * Format satellites as natural language
 */
function formatSatellitesResponse(satellites: Awaited<ReturnType<typeof getSatelliteStatuses>>): string {
  if (satellites.length === 0) {
    return 'No satellite agents registered.';
  }

  const healthy = satellites.filter((s) => !s.is_stale && s.alert_state === 'ok');
  const stale = satellites.filter((s) => s.is_stale);
  const alerts = satellites.filter((s) => !s.is_stale && s.alert_state !== 'ok');

  const parts: string[] = [];

  if (stale.length > 0) {
    parts.push(`⚠️  ${stale.length} satellite${stale.length === 1 ? ' is' : 's are'} not reporting.`);
  }

  if (alerts.length > 0) {
    parts.push(`⚠️  ${alerts.length} satellite${alerts.length === 1 ? ' has' : 's have'} alerts.`);
  }

  if (healthy.length > 0 && stale.length === 0 && alerts.length === 0) {
    parts.push(`✅ All ${healthy.length} satellite${healthy.length === 1 ? '' : 's'} reporting normally.`);
  }

  return parts.join(' ');
}

/**
 * Format stacks as natural language
 */
function formatStacksResponse(stacks: Awaited<ReturnType<typeof getStacksSummary>>): string {
  if (stacks.total === 0) {
    return 'No stacks configured.';
  }

  if (stacks.total <= 3) {
    return `${stacks.total} stack${stacks.total === 1 ? '' : 's'}: ${stacks.names.join(', ')}.`;
  }

  return `${stacks.total} stacks configured: ${stacks.names.slice(0, 3).join(', ')}, and ${stacks.total - 3} more.`;
}
