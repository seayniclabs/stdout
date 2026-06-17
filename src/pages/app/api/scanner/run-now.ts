import type { APIRoute } from 'astro';
import { getScannerSchedule } from '../../../../lib/scanner';

export const POST: APIRoute = async ({ locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const schedule = await getScannerSchedule();

    if (!schedule.enabled) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Scanner is disabled. Enable it first in the scanner settings.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Trigger the scanner by making a request to the scanner endpoint
    // The scanner runs in the background, so we just trigger it and return
    const scannerUrl = process.env.SCANNER_ENDPOINT || 'http://localhost:4321/app/api/scanner/scan';

    // Fire and forget - don't wait for the scan to complete
    fetch(scannerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
