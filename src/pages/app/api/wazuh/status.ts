import type { APIRoute } from 'astro';
import { getWazuhMetrics } from '../../../../lib/wazuh';

/**
 * GET /app/api/wazuh/status?format=json|prometheus
 *
 * Returns Wazuh metrics for monitoring dashboards.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const format = url.searchParams.get('format') || 'json';
  const metrics = getWazuhMetrics(locals.user.id);

  if (format === 'prometheus') {
    const prometheus = `
# HELP wazuh_alerts_total Total number of Wazuh alerts
# TYPE wazuh_alerts_total counter
wazuh_alerts_total ${metrics.totalAlerts}

# HELP wazuh_alerts_by_severity Wazuh alerts by severity
# TYPE wazuh_alerts_by_severity gauge
wazuh_alerts_by_severity{severity="critical"} ${metrics.criticalAlerts}
wazuh_alerts_by_severity{severity="warning"} ${metrics.warningAlerts}
wazuh_alerts_by_severity{severity="info"} ${metrics.infoAlerts}

# HELP wazuh_incidents_created Incidents created from Wazuh alerts
# TYPE wazuh_incidents_created counter
wazuh_incidents_created ${metrics.incidentsCreated}

# HELP wazuh_remediations_triggered Auto-remediations triggered
# TYPE wazuh_remediations_triggered counter
wazuh_remediations_triggered ${metrics.remediationsTriggered}
`.trim();

    return new Response(prometheus, {
      headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    });
  }

  return new Response(JSON.stringify(metrics, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
