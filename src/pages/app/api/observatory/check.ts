/**
 * Observatory Manual Check Endpoint
 *
 * POST /app/api/observatory/check
 * Triggers an immediate Observatory check for all stacks
 */

import type { APIRoute } from 'astro';
import { runScheduledCheck } from '../../../../lib/observatory/sentinel';

export const POST: APIRoute = async ({ locals }) => {
  const session = locals.session;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const result = await runScheduledCheck(session.userId);

    return new Response(JSON.stringify({
      success: true,
      stacksChecked: result.stacksChecked,
      anomaliesDetected: result.anomaliesDetected,
      incidentsCreated: result.incidentsCreated,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[Observatory Check API] Error:', error);
    return new Response(JSON.stringify({
      error: 'Check failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
