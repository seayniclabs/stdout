import type { APIRoute } from 'astro';

/**
 * Scanner endpoint that triggers comprehensive network discovery
 * This is called by the "Run Scan Now" button and scheduled scans
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_monitors');
  if (rbacBlock) return rbacBlock;

  console.log('[scanner/scan] Triggering comprehensive network discovery...');

  try {
    // Forward to the comprehensive discovery endpoint with default options
    const discoveryUrl = new URL('/app/api/discovery/scan', request.url);

    const response = await fetch(discoveryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward the auth cookie
        'Cookie': request.headers.get('Cookie') || '',
      },
      body: JSON.stringify({
        arpScan: true,
        mdnsScan: true,
        ssdpScan: true,
        vendorLookup: true,
        timeout: 10,
        createEntities: true,
        createMonitors: true,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Discovery scan failed');
    }

    console.log(`[scanner/scan] Discovery complete: ${result.devicesFound} devices, ${result.entitiesCreated} entities, ${result.monitorsCreated} monitors`);

    return new Response(JSON.stringify({
      success: true,
      ...result,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[scanner/scan] Scan failed:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
