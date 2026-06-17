import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ locals, request }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getDb();
    const schedule = db.select().from(schema.scannerSchedule)
      .where(eq(schema.scannerSchedule.userId, session.id)).get();

    if (schedule && !schedule.enabled) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Scanner is disabled. Enable it first in the scanner settings.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Trigger the scanner by making a request to the scanner endpoint
    // Use request.url to get the correct host/port instead of hardcoded localhost:4321
    const scannerUrl = new URL('/app/api/scanner/scan', request.url);

    // Fire and forget - don't wait for the scan to complete
    fetch(scannerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward the cookie to maintain auth context
        'Cookie': request.headers.get('Cookie') || '',
      },
    }).catch(err => {
      console.error('[run-now] Failed to trigger scanner:', err);
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Scanner started. Results will appear in the HUD shortly.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[run-now] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start scanner'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
