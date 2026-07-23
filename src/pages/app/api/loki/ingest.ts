import type { APIRoute } from 'astro';
import {
  buildLogQL,
  getLokiConfig,
  hasLogData,
  ingestFromLoki,
  ingestLokiEntries,
  payloadFromBody,
  queryLokiRange,
  aggregateLokiMetrics,
  groupErrorsByService,
  type LokiLogEntry,
  type LokiQueryOpts,
} from '../../../../lib/loki';
import { requireAuth } from '../../../../lib/rbac';

/**
 * POST /app/api/loki/ingest
 *
 * Bearer-token-authenticated ingest for Grafana Loki logs via the LogQL
 * query API (`/loki/api/v1/query_range`). Aggregates volume/error metrics
 * into Observatory baselines and opens incidents for >2σ spikes or
 * critical log bursts.
 *
 * Body shapes:
 *   { query: "{job=\"stdout\"} |= \"error\"", minutes?: 15, limit?: 500 }
 *   { job: "stdout", minutes?: 5 }
 *   { service: "api", job?: "...", minutes?: 15 }
 *   { streams: [ { stream: {...}, values: [[tsNs, line], ...] } ] }  — pre-fetched
 *   { logs: [ { message, labels?, timestamp? } ] }                   — pre-fetched
 *
 * Defaults to job=stdout. Lookback is clamped to 1–1440 minutes (rejects start=0).
 * Sentinel pulls on a 5-minute cadence when a Loki source is configured.
 *
 * Query params:
 *   dryRun=1        — parse/aggregate only (no baselines or incidents)
 *   noIncidents=1   — update baselines without creating incidents
 *   minutes=N       — override lookback window (default 15, max 1440)
 *   limit=N         — override Loki result limit (default 500)
 */
export const POST: APIRoute = async ({ locals, request, url, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  const dryRun = url.searchParams.get('dryRun') === '1'
    || url.searchParams.get('dry_run') === '1';
  const noIncidents = url.searchParams.get('noIncidents') === '1'
    || url.searchParams.get('no_incidents') === '1';

  let body: Record<string, unknown> = {};
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      } else if (Array.isArray(parsed)) {
        body = { logs: parsed };
      }
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || (body as any)._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { queryOpts, entries: bodyEntries } = payloadFromBody(body);
  const minutesParam = url.searchParams.get('minutes');
  const limitParam = url.searchParams.get('limit');

  const opts: LokiQueryOpts & { entries?: LokiLogEntry[]; createIncidents?: boolean } = {
    ...queryOpts,
    minutes: minutesParam ? Number(minutesParam) : queryOpts.minutes,
    limit: limitParam ? Number(limitParam) : queryOpts.limit,
  };

  if (hasLogData(bodyEntries)) {
    opts.entries = bodyEntries as LokiLogEntry[];
  }

  const query = buildLogQL(opts);

  if (dryRun) {
    // Dry-run with pre-supplied logs: no live Loki call.
    if (hasLogData(opts.entries)) {
      const entries = opts.entries as LokiLogEntry[];
      const metrics = aggregateLokiMetrics(entries);
      const errorGroups = groupErrorsByService(entries);
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        query,
        entriesFetched: entries.length,
        metrics,
        errorGroups,
        sampleLines: entries
          .filter((e) => e.severity === 'critical' || e.severity === 'error')
          .slice(0, 10)
          .map((e) => e.message.slice(0, 200)),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Dry-run with live query: fetch + aggregate only (no baselines/incidents).
    try {
      const config = getLokiConfig(locals.user.id);
      if (!config) {
        return new Response(JSON.stringify({
          error: 'No Loki data source configured. Add a Loki source in Settings, set LOKI_URL, or supply streams/logs in the body.',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const { query: liveQuery, entries } = await queryLokiRange(config, opts);
      const metrics = aggregateLokiMetrics(entries);
      const errorGroups = groupErrorsByService(entries);
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        query: liveQuery,
        entriesFetched: entries.length,
        metrics,
        errorGroups,
        sampleLines: entries
          .filter((e) => e.severity === 'critical' || e.severity === 'error')
          .slice(0, 10)
          .map((e) => e.message.slice(0, 200)),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : String(error) || 'Loki query failed',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Require either pre-supplied logs or a query intent (labels / LogQL / defaults).
  if (!hasLogData(opts.entries) && !opts.query && !opts.service && !opts.job
      && !opts.container && !opts.app && !url.searchParams.has('query')) {
    // Default LogQL is fine — proceed with DEFAULT_ERROR_LOGQL via buildLogQL.
  }

  try {
    let result;
    if (hasLogData(opts.entries)) {
      result = await ingestLokiEntries(locals.user.id, opts.entries as LokiLogEntry[], {
        createIncidents: !noIncidents,
        query,
      });
    } else {
      result = await ingestFromLoki(locals.user.id, {
        ...opts,
        createIncidents: !noIncidents,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      query: result.query,
      entriesFetched: result.entriesFetched,
      metrics: result.metrics,
      errorGroups: result.errorGroups,
      anomalies: result.anomalies,
      baselinesUpdated: result.baselinesUpdated,
      incidentIds: result.incidentIds,
      sampleLines: result.sampleLines,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[loki/ingest]', error);
    const msg = error instanceof Error ? error.message : String(error) || 'Ingest failed';
    const status = /No Loki data source/i.test(msg) ? 400
      : /Loki \d{3}/.test(msg) || /timed out/i.test(msg) ? 502
        : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/** GET /app/api/loki/ingest — health / usage hint */
export const GET: APIRoute = async ({ locals }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkLokiHealth, getLokiConfig, getLastLokiMetrics } = await import('../../../../lib/loki');
  const config = getLokiConfig(locals.user.id);
  const health = config ? await checkLokiHealth(config) : { ok: false, error: 'not configured' };
  return new Response(JSON.stringify({
    ok: true,
    configured: !!config,
    url: config?.url ?? null,
    healthy: health.ok,
    health,
    lastMetrics: getLastLokiMetrics(locals.user.id),
    schedule: {
      intervalMinutes: 5,
      labels: { job: 'stdout', __tmp_durable_executor: 'loki' },
      endpoint: '/loki/api/v1/query_range',
    },
    usage: {
      method: 'POST',
      body: {
        query: '{job="stdout",__tmp_durable_executor="loki"} |= "error"',
        minutes: 15,
        limit: 500,
      },
      or: { job: 'stdout', executor: true, minutes: 5 },
      orPreFetched: { logs: [{ message: 'error: boom', labels: { job: 'stdout' } }] },
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
