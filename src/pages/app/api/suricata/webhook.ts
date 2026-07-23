import type { APIRoute } from 'astro';
import {
  classifySuricataEve,
  ingestSuricataBatch,
  ingestSuricataEve,
  parseEveLine,
  resetCorrelationState,
} from '../../../../lib/suricata';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';

/**
 * POST /app/api/suricata/webhook
 *
 * Bearer-token-authenticated ingest for Suricata EVE JSON alerts.
 *
 * Accepts:
 *   - A single EVE alert object
 *   - { events: [ ... ] } batch
 *   - NDJSON string body (Content-Type: application/x-ndjson)
 *
 * Query params:
 *   autoFix=0  — ingest only (no Windlass action)
 *   dryRun=1   — classify only, no side effects
 *   resetCorrelation=1 — clear in-memory correlation (tests)
 */
export const POST: APIRoute = async ({ locals, request, url, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - ingesting Suricata events is a management operation
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  let csrfToken: string | undefined;

  // For NDJSON, CSRF token must be in header
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('ndjson') || contentType.includes('x-ndjson')) {
    csrfToken = request.headers.get('x-csrf-token') || undefined;
  } else {
    // For JSON, can be in header or body
    const bodyText = await request.text();
    try {
      const parsed = JSON.parse(bodyText);
      csrfToken = request.headers.get('x-csrf-token') || (parsed as any)._csrf;
      // Re-create request with text for later parsing
      request = new Request(request, { body: bodyText });
    } catch {
      // Invalid JSON, will fail later
    }
  }

  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (url.searchParams.get('resetCorrelation') === '1') {
    resetCorrelationState();
  }

  let events: Record<string, unknown>[] = [];

  try {
    if (contentType.includes('ndjson') || contentType.includes('x-ndjson')) {
      const text = await request.text();
      for (const line of text.split('\n')) {
        const obj = parseEveLine(line);
        if (obj) events.push(obj);
      }
    } else {
      const parsed = await request.json();
      if (Array.isArray(parsed)) {
        events = parsed.filter(e => e && typeof e === 'object' && !Array.isArray(e));
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray((parsed as any).events)) {
          events = (parsed as any).events.filter(
            (e: unknown) => e && typeof e === 'object' && !Array.isArray(e),
          );
        } else {
          events = [parsed as Record<string, unknown>];
        }
      }
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON / NDJSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (events.length === 0) {
    return new Response(JSON.stringify({
      error: 'Expected a Suricata EVE alert object, { events: [...] }, or NDJSON lines',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dryRun = url.searchParams.get('dryRun') === '1'
    || url.searchParams.get('dry_run') === '1';

  if (dryRun) {
    const classified = events.map(e => classifySuricataEve(e, { correlate: true }));
    return new Response(JSON.stringify({
      ok: true,
      dryRun: true,
      count: classified.length,
      alerts: classified,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const autoFixParam = url.searchParams.get('autoFix') ?? url.searchParams.get('auto_fix');
  const autoFix = autoFixParam !== '0' && autoFixParam !== 'false';

  try {
    if (events.length === 1) {
      const result = await ingestSuricataEve(locals.user.id, events[0], { autoFix });
      return new Response(JSON.stringify({
        ok: true,
        alert: result.alert,
        incidentId: result.incidentId,
        fix: result.fix,
        alertEventId: result.alertEventId,
        skipped: result.skipped ?? false,
        skipReason: result.skipReason,
      }), {
        status: result.skipped ? 200 : 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const batch = await ingestSuricataBatch(locals.user.id, events, { autoFix });
    return new Response(JSON.stringify({
      ok: true,
      processed: batch.processed,
      skipped: batch.skipped,
      results: batch.results.map(r => ({
        alert: r.alert,
        incidentId: r.incidentId,
        fix: r.fix,
        alertEventId: r.alertEventId,
      })),
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[suricata/webhook]', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error) || 'Ingest failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
