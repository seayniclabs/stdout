import type { APIRoute } from 'astro';
import {
  classifySuricataEve,
  ingestSuricataBatch,
  ingestSuricataEve,
  parseEveLine,
  resetCorrelationState,
} from '../../../../lib/suricata';

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
export const POST: APIRoute = async ({ locals, request, url }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({
      error: 'Unauthorized. Provide Authorization: Bearer stdout_scan_<token>',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (url.searchParams.get('resetCorrelation') === '1') {
    resetCorrelationState();
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
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
