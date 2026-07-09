import type { APIRoute } from 'astro';
import { getCVEMetrics } from '../../../../lib/cve-scanner';

/**
 * GET /app/api/cve/status?format=json|prometheus
 *
 * Returns CVE scanner metrics for monitoring dashboards.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const format = url.searchParams.get('format') || 'json';
  const metrics = getCVEMetrics(locals.user.id);

  if (format === 'prometheus') {
    const prometheus = `
# HELP cve_vulnerabilities_total Total number of CVE vulnerabilities
# TYPE cve_vulnerabilities_total counter
cve_vulnerabilities_total ${metrics.totalVulns}

# HELP cve_vulnerabilities_by_severity CVE vulnerabilities by severity
# TYPE cve_vulnerabilities_by_severity gauge
cve_vulnerabilities_by_severity{severity="critical"} ${metrics.criticalVulns}
cve_vulnerabilities_by_severity{severity="high"} ${metrics.highVulns}
cve_vulnerabilities_by_severity{severity="medium"} ${metrics.mediumVulns}
cve_vulnerabilities_by_severity{severity="low"} ${metrics.lowVulns}

# HELP cve_incidents_created Incidents created from CVE vulnerabilities
# TYPE cve_incidents_created counter
cve_incidents_created ${metrics.incidentsCreated}
`.trim();

    return new Response(prometheus, {
      headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    });
  }

  return new Response(JSON.stringify(metrics, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
