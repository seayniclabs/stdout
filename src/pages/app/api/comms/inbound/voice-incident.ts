import type { APIRoute } from 'astro';
import { analyzeVoiceIncident } from '../../../../../lib/comms/voice-incident';

/**
 * Voice incident analysis endpoint (BB15 — Sonique / CLI)
 *
 * POST /app/api/comms/inbound/voice-incident
 *
 * Callers must authenticate via a Bearer API token or session cookie.
 * The middleware sets locals.user when either is present; this endpoint
 * derives the user id from that principal only — never from the request body.
 *
 * Body: {
 *   text: string;      // Voice transcript or typed incident query
 *   channel?: string;  // Default "sonique"
 * }
 *
 * Response: {
 *   spoken_summary: string;
 *   response: string;
 *   rootCauses: string[];
 *   suggestedCommands: string[];
 *   model: string | null;
 *   metadata: object;
 * }
 */

// Restrict CORS to the configured app origin.  Credentialed endpoints must
// not send Access-Control-Allow-Origin: * because browsers will block the
// pre-flight and, more importantly, the wildcard signals to scanners that any
// origin can read the response.
const allowedOrigin = process.env.STDOUT_ORIGIN ?? process.env.STDOUT_TEST_URL ?? 'http://localhost:4321';

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin === allowedOrigin ? origin : allowedOrigin;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  const userId = locals.user?.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  let body: { text?: string; channel?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const text = (body.text || '').trim();
  if (!text) {
    return new Response(JSON.stringify({ error: 'Missing required field: text' }), {
      status: 400,
      headers,
    });
  }

  try {
    const result = await analyzeVoiceIncident(userId, text);
    return new Response(
      JSON.stringify({ ...result, channel: body.channel || 'sonique' }),
      { status: 200, headers },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Internal server error';
    console.error('[comms/voice-incident] Error:', error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
};
