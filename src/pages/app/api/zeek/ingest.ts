import type { APIRoute } from 'astro';
import {
  analyzeAndPullZeekLogs,
  aggregateZeekMetrics,
  bundleFromBody,
  bundleHasData,
  correlateZeekLogs,
  ingestZeekLogs,
  parseZeekBundle,
  pullZeekLogsFromContainer,
} from '../../../../lib/zeek';

/**
 * POST /app/api/zeek/ingest
 *
 * Bearer-token-authenticated ingest for Zeek protocol logs
 * (conn / dns / http / ssl / notice). Aggregates metrics into Observatory
 * baselines, correlates notices with related flows, and opens incidents
 * for high-severity notices and >2σ anomalies.
 *
 * Body shapes:
 *   { conn, dns, http, ssl, notice }           — raw TSV or JSONL per type
 *   { logs: { conn, ... } }
 *   { type: "conn", content: "..." }
 *   { type: "dns", records: [ {...} ] }
 *
 * Query params:
 *   dryRun=1   — parse/aggregate/correlate only (no baselines or incidents)
 *   pull=1     — read /logs/*.log from the local zeek container
 *   analyze=1  — run zeek -r on the latest pcap, then pull (implies pull)
 *   noIncidents=1 — update baselines without creating incidents
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

  const dryRun = url.searchParams.get('dryRun') === '1'
    || url.searchParams.get('dry_run') === '1';
  const pull = url.searchParams.get('pull') === '1';
  const analyze = url.searchParams.get('analyze') === '1';
  const noIncidents = url.searchParams.get('noIncidents') === '1'
    || url.searchParams.get('no_incidents') === '1';

  let body: Record<string, unknown> = {};
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (contentType.includes('text/plain') || contentType.includes('application/x-zeek')) {
    const text = await request.text();
    const typeParam = url.searchParams.get('type') || 'conn';
    body = { type: typeParam, content: text };
  }

  let bundle = bundleFromBody(body);

  if (analyze) {
    const pulled = await analyzeAndPullZeekLogs();
    if (pulled) bundle = { ...pulled, ...bundle };
  } else if (pull) {
    const pulled = await pullZeekLogsFromContainer();
    if (pulled) bundle = { ...pulled, ...bundle };
  }

  if (!bundleHasData(bundle)) {
    return new Response(JSON.stringify({
      error: 'No Zeek log data. Provide conn/dns/http/ssl/notice fields, or use ?pull=1 / ?analyze=1.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (dryRun) {
    const byType = parseZeekBundle(bundle);
    const metrics = aggregateZeekMetrics(byType);
    const correlations = correlateZeekLogs(byType);
    const recordsParsed = Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, v.length]),
    );
    return new Response(JSON.stringify({
      ok: true,
      dryRun: true,
      recordsParsed,
      metrics,
      correlations,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await ingestZeekLogs(locals.user.id, bundle, {
      createIncidents: !noIncidents,
    });
    return new Response(JSON.stringify({
      ok: true,
      recordsParsed: result.recordsParsed,
      metrics: result.metrics,
      correlations: result.correlations,
      anomalies: result.anomalies,
      baselinesUpdated: result.baselinesUpdated,
      incidentIds: result.incidentIds,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[zeek/ingest]', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error) || 'Ingest failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
