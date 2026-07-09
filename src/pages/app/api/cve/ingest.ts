import type { APIRoute } from 'astro';
import { processCVEScan, parseTrivyReport, parseGrypeReport, type CVEScanResult } from '../../../../lib/cve-scanner';

/**
 * POST /app/api/cve/ingest
 *
 * Ingests CVE scan reports from Trivy or Grype.
 *
 * Usage with Trivy:
 * ```bash
 * trivy image --format json nginx:latest | \
 *   curl -X POST http://localhost:8112/app/api/cve/ingest \
 *     -H "Authorization: Bearer YOUR_API_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d @-
 * ```
 *
 * Usage with Grype:
 * ```bash
 * grype nginx:latest --output json | \
 *   curl -X POST http://localhost:8112/app/api/cve/ingest \
 *     -H "Authorization: Bearer YOUR_API_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d @-
 * ```
 *
 * Expected JSON formats:
 * - Trivy: { "Results": [...] }
 * - Grype: { "matches": [...] }
 */
export const POST: APIRoute = async ({ locals, request }) => {
  // Auth: require valid API token or session
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Detect scanner type and parse
  let scan: CVEScanResult;
  try {
    if (body.Results) {
      // Trivy format
      const target = body.ArtifactName || body.Results?.[0]?.Target || 'unknown';
      scan = parseTrivyReport(body, target);
    } else if (body.matches) {
      // Grype format
      const target = body.source?.target?.userInput || 'unknown';
      scan = parseGrypeReport(body, target);
    } else {
      return new Response(JSON.stringify({ error: 'Unrecognized scanner format (expected Trivy or Grype)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err: any) {
    console.error('CVE parse error:', err);
    return new Response(JSON.stringify({ error: `Parse error: ${err.message}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Process scan
  try {
    await processCVEScan(scan, locals.user.id);

    return new Response(JSON.stringify({
      ok: true,
      scanner: scan.scanner,
      target: scan.target,
      totalVulnerabilities: scan.vulnerabilities.length,
      criticalVulnerabilities: scan.vulnerabilities.filter(v => v.severity === 'CRITICAL').length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('CVE ingest error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
