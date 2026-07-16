import type { APIRoute } from 'astro';
import { classifyNetdataAnomaly, ingestNetdataAnomaly } from '../../../../lib/netdata';

/**
 * POST /app/api/netdata/webhook
 *
 * Bearer-token-authenticated ingest for Netdata Cloud notifications.
 * Configure in Netdata Cloud → Space settings → Notifications → Webhook:
 *   URL:    https://<your-stdout>/app/api/netdata/webhook
 *   Header: Authorization: Bearer stdout_scan_<token>
 *
 * Accepts Netdata Cloud alert and reachability payloads. Classifies the
 * anomaly, creates an incident for warning/critical, and asks Windlass to
 * apply a fix (memory/disk shed, service restart).
 *
 * Query params:
 *   autoFix=0  — ingest only (no Windlass action)
 *   dryRun=1   — classify only, no side effects
 */
export const POST: APIRoute = async ({ locals, request, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({
      error: 'Unauthorized. Provide Authorization: Bearer stdout_scan_<token>',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Response(JSON.stringify({ error: 'JSON object required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Minimal validity: alert, reachability, or explicit message
  const hasAlert = typeof body.alert === 'string' || typeof body.message === 'string';
  const hasReachability = body.status && typeof body.status === 'object';
  if (!hasAlert && !hasReachability) {
    return new Response(JSON.stringify({
      error: 'Unrecognized payload. Expected Netdata Cloud alert or reachability notification.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dryRun = url.searchParams.get('dryRun') === '1'
    || url.searchParams.get('dry_run') === '1';
  if (dryRun) {
    const anomaly = classifyNetdataAnomaly(body);
    return new Response(JSON.stringify({ ok: true, dryRun: true, anomaly }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const autoFixParam = url.searchParams.get('autoFix') ?? url.searchParams.get('auto_fix');
  const autoFix = autoFixParam !== '0' && autoFixParam !== 'false';

  try {
    const result = await ingestNetdataAnomaly(locals.user.id, body, { autoFix });
    return new Response(JSON.stringify({
      ok: true,
      anomaly: result.anomaly,
      incidentId: result.incidentId,
      fix: result.fix,
      alertEventId: result.alertEventId,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[netdata/webhook]', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error) || 'Ingest failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
