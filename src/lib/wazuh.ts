/**
 * Wazuh Host IDS Integration
 *
 * Ingests Wazuh OSSEC alerts and integrates with Observatory AI.
 *
 * Features:
 * - Alert classification (critical/warning/info)
 * - Correlation with incidents
 * - Auto-remediation via Windlass
 * - Metrics for Prometheus
 *
 * Wazuh Alert Structure:
 * ```json
 * {
 *   "timestamp": "2024-01-01T12:00:00.000Z",
 *   "rule": {
 *     "level": 10,
 *     "description": "Multiple authentication failures",
 *     "id": "5503",
 *     "groups": ["authentication_failed", "pci_dss_10.2.4"]
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

import { getDb, schema } from './db';
import { eq, desc, and } from 'drizzle-orm';

export interface WazuhAlert {
  timestamp: string;
  rule: {
    level: number;
    description: string;
    id: string;
    groups?: string[];
  };
  agent?: {
    id: string;
    name: string;
    ip?: string;
  };
  data?: Record<string, any>;
  full_log?: string;
}

export interface WazuhMetrics {
  totalAlerts: number;
  criticalAlerts: number;
  warningAlerts: number;
  infoAlerts: number;
  incidentsCreated: number;
  remediationsTriggered: number;
  topRules: Array<{ ruleId: string; count: number }>;
}

/**
 * Classify alert severity based on Wazuh rule level
 */
export function classifyWazuhSeverity(level: number): 'critical' | 'warning' | 'info' {
  if (level >= 10) return 'critical';  // High severity
  if (level >= 7) return 'warning';    // Medium severity
  return 'info';                       // Low severity
}

/**
 * Process incoming Wazuh alert
 */
export async function processWazuhAlert(alert: WazuhAlert, userId: number): Promise<void> {
  const db = getDb();
  const severity = classifyWazuhSeverity(alert.rule.level);

  // Log to wazuh_alerts table (if exists)
  try {
    db.run(`
      INSERT INTO wazuh_alerts (
        timestamp,
        rule_id,
        rule_level,
        rule_description,
        agent_id,
        agent_name,
        agent_ip,
        src_ip,
        severity,
        full_log,
        user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      alert.timestamp || new Date().toISOString(),
      alert.rule.id,
      alert.rule.level,
      alert.rule.description,
      alert.agent?.id || null,
      alert.agent?.name || null,
      alert.agent?.ip || null,
      alert.data?.srcip || null,
      severity,
      alert.full_log || JSON.stringify(alert),
      userId
    ]);
  } catch (err) {
    // Table may not exist yet (fresh install)
    console.warn('wazuh_alerts table not found — skipping persistence');
  }

  // Create incident for critical alerts
  if (severity === 'critical') {
    await createIncidentFromWazuhAlert(alert, userId);
  }

  // Auto-remediation: Block IP for authentication failures
  if (alert.rule.groups?.includes('authentication_failed') && alert.data?.srcip) {
    await triggerWazuhRemediation(alert, userId);
  }
}

/**
 * Create incident from Wazuh alert
 */
async function createIncidentFromWazuhAlert(alert: WazuhAlert, userId: number): Promise<void> {
  const db = getDb();

  // Check for recent similar incidents (correlation window: 5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const existingIncident = db.select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.userId, userId),
        eq(schema.incidents.severity, 'critical')
      )
    )
    .orderBy(desc(schema.incidents.createdAt))
    .limit(1)
    .get();

  if (existingIncident && existingIncident.createdAt > fiveMinutesAgo) {
    // Group with existing incident
    console.log(`Grouped Wazuh alert ${alert.rule.id} with incident ${existingIncident.id}`);
    return;
  }

  // Create new incident
  const agentName = alert.agent?.name || 'Unknown Host';
  const description = `
**Wazuh Alert Detected**

**Rule:** ${alert.rule.description} (ID: ${alert.rule.id})
**Level:** ${alert.rule.level}
**Agent:** ${agentName} (${alert.agent?.ip || 'N/A'})
**Source IP:** ${alert.data?.srcip || 'N/A'}
**Source User:** ${alert.data?.srcuser || 'N/A'}

**Full Log:**
\`\`\`
${alert.full_log || JSON.stringify(alert, null, 2)}
\`\`\`
`.trim();

  db.insert(schema.incidents).values({
    title: `Wazuh: ${alert.rule.description}`,
    description,
    severity: 'critical',
    status: 'investigating',
    userId,
    tags: JSON.stringify(['wazuh', 'host-ids', 'auto']),
    createdAt: new Date().toISOString(),
  }).run();

  console.log(`Created incident for Wazuh alert ${alert.rule.id}`);
}

/**
 * Trigger auto-remediation via Windlass
 */
async function triggerWazuhRemediation(alert: WazuhAlert, userId: number): Promise<void> {
  const db = getDb();

  // Get Windlass endpoint from config
  const windlassConfig = db.select()
    .from(schema.windlassConfig)
    .where(eq(schema.windlassConfig.userId, userId))
    .get();

  if (!windlassConfig || !windlassConfig.endpointUrl) {
    console.warn('Windlass not configured — skipping remediation');
    return;
  }

  const srcIp = alert.data?.srcip;
  if (!srcIp) {
    console.warn('No source IP in Wazuh alert — cannot block');
    return;
  }

  try {
    const response = await fetch(`${windlassConfig.endpointUrl}/v1/block-ip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: srcIp,
        reason: `Wazuh: ${alert.rule.description}`,
        duration: 3600, // 1 hour
      }),
    });

    if (!response.ok) {
      console.error(`Windlass block-ip failed: ${response.statusText}`);
      return;
    }

    console.log(`Blocked IP ${srcIp} via Windlass for Wazuh alert ${alert.rule.id}`);
  } catch (err) {
    console.error('Windlass remediation error:', err);
  }
}

/**
 * Get Wazuh metrics for Prometheus
 */
export function getWazuhMetrics(userId: number): WazuhMetrics {
  const db = getDb();

  try {
    const alerts = db.prepare(`
      SELECT severity, rule_id
      FROM wazuh_alerts
      ORDER BY timestamp DESC
      LIMIT 1000
    `).all() as Array<{ severity: string; rule_id: string }>;

    const metrics: WazuhMetrics = {
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
      warningAlerts: alerts.filter(a => a.severity === 'warning').length,
      infoAlerts: alerts.filter(a => a.severity === 'info').length,
      incidentsCreated: 0,
      remediationsTriggered: 0,
      topRules: [],
    };

    // Count top rules
    const ruleCounts = alerts.reduce((acc, alert) => {
      acc[alert.rule_id] = (acc[alert.rule_id] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    metrics.topRules = Object.entries(ruleCounts)
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return metrics;
  } catch (err) {
    console.warn('Wazuh metrics unavailable:', err);
    return {
      totalAlerts: 0,
      criticalAlerts: 0,
      warningAlerts: 0,
      infoAlerts: 0,
      incidentsCreated: 0,
      remediationsTriggered: 0,
      topRules: [],
    };
  }
}
