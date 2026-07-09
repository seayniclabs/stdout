import type { APIRoute } from 'astro';
import { processWazuhAlert, type WazuhAlert } from '../../../../lib/wazuh';

/**
 * POST /app/api/wazuh/webhook
 *
 * Receives Wazuh OSSEC alerts via webhook and processes them.
 *
 * Setup:
 * 1. Configure Wazuh integration in /var/ossec/etc/ossec.conf:
 *    ```xml
 *    <integration>
 *      <name>custom-webhook</name>
 *      <hook_url>http://YOUR_STDOUT_URL:8112/app/api/wazuh/webhook</hook_url>
 *      <level>7</level> <!-- Alert level threshold -->
 *      <alert_format>json</alert_format>
 *    </integration>
 *    ```
 *
 * 2. Restart Wazuh manager: `systemctl restart wazuh-manager`
 *
 * Expected JSON format:
 * ```json
 * {
 *   "timestamp": "2024-01-01T12:00:00.000Z",
 *   "rule": {
 *     "level": 10,
 *     "description": "Multiple authentication failures",
 *     "id": "5503",
 *     "groups": ["authentication_failed"]
 *   },
 *   "agent": {
 *     "id": "001",
 *     "name": "web-server-01",
 *     "ip": "192.168.1.100"
 *   },
 *   "data": {
 *     "srcip": "203.0.113.42",
 *     "srcuser": "admin"
 *   }
 * }
 * ```
 */
export const POST: APIRoute = async ({ locals, request }) => {
  // Auth: require valid API token or session
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: WazuhAlert;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.rule || !body.rule.level || !body.rule.description) {
    return new Response(JSON.stringify({ error: 'Missing required fields: rule.level, rule.description' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Process alert
  try {
    await processWazuhAlert(body, locals.user.id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Wazuh webhook error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
