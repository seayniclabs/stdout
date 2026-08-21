/**
 * Alert Routing System
 *
 * Routes alerts to configured destinations (Slack, webhooks, email, etc.)
 * with deduplication, suppression windows, and escalation logic.
 */

import { getSqlite } from '../db';

export interface Alert {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  source: string; // 'riggins' | 'watcher' | 'monitor' | 'manual'
  metadata?: Record<string, any>;
  created_at: number;
  fingerprint?: string; // For deduplication
}

export interface AlertRoute {
  id: string;
  user_id?: string;
  name: string;
  type: 'slack' | 'webhook' | 'email' | 'discord';
  config: SlackConfig | WebhookConfig | EmailConfig | DiscordConfig;
  enabled: boolean;
  min_severity: 'critical' | 'high' | 'medium' | 'low';
  created_at: number;
  updated_at: number;
}

export interface SlackConfig {
  webhook_url: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

export interface WebhookConfig {
  url: string;
  method: 'POST' | 'GET';
  headers?: Record<string, string>;
}

export interface EmailConfig {
  to: string;
  from?: string;
  smtp_host?: string;
  smtp_port?: number;
}

export interface DiscordConfig {
  webhook_url: string;
  username?: string;
  avatar_url?: string;
}

/**
 * Send an alert to all configured routes
 */
export async function sendAlert(alert: Alert, userId: string): Promise<void> {
  const db = getSqlite();

  // Store alert in database
  db.prepare(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata TEXT,
      fingerprint TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    INSERT INTO alerts (id, severity, title, message, source, metadata, fingerprint, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    alert.id,
    alert.severity,
    alert.title,
    alert.message,
    alert.source,
    alert.metadata ? JSON.stringify(alert.metadata) : null,
    alert.fingerprint || null,
    alert.created_at
  );

  // Check for suppression
  if (await isAlertSuppressed(alert, userId)) {
    console.log(`[Alert Router] Alert ${alert.id} suppressed (duplicate or within suppression window)`);
    return;
  }

  // Get enabled routes for this user
  const routes = getAlertRoutes(userId);
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  for (const route of routes) {
    if (!route.enabled) continue;

    // Check severity threshold
    if (severityOrder[alert.severity] > severityOrder[route.min_severity]) {
      continue; // Alert severity too low for this route
    }

    try {
      await routeAlert(alert, route);
      console.log(`[Alert Router] Sent ${alert.severity} alert to ${route.type} (${route.name})`);
    } catch (error) {
      console.error(`[Alert Router] Failed to send alert to ${route.name}:`, error);
    }
  }

  // Mark alert as sent
  db.prepare(`
    UPDATE alerts SET status = 'sent', sent_at = ? WHERE id = ?
  `).run(Date.now(), alert.id);
}

/**
 * Route alert to specific destination
 */
async function routeAlert(alert: Alert, route: AlertRoute): Promise<void> {
  switch (route.type) {
    case 'slack':
      await sendToSlack(alert, route.config as SlackConfig);
      break;
    case 'webhook':
      await sendToWebhook(alert, route.config as WebhookConfig);
      break;
    case 'discord':
      await sendToDiscord(alert, route.config as DiscordConfig);
      break;
    case 'email':
      // Email not implemented yet - would need SMTP client
      console.log('[Alert Router] Email routing not implemented yet');
      break;
  }
}

/**
 * Send alert to Slack
 */
async function sendToSlack(alert: Alert, config: SlackConfig): Promise<void> {
  const severityEmoji = {
    critical: '🚨',
    high: '⚠️',
    medium: '⚡',
    low: 'ℹ️',
  };

  const severityColor = {
    critical: '#FF0000',
    high: '#FF9500',
    medium: '#FFCC00',
    low: '#36A64F',
  };

  const payload = {
    username: config.username || 'StdOut',
    icon_emoji: config.icon_emoji || ':robot_face:',
    channel: config.channel,
    attachments: [
      {
        color: severityColor[alert.severity],
        title: `${severityEmoji[alert.severity]} ${alert.title}`,
        text: alert.message,
        fields: [
          { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
          { title: 'Source', value: alert.source, short: true },
        ],
        footer: 'StdOut Observatory',
        ts: Math.floor(alert.created_at / 1000),
      },
    ],
  };

  const response = await fetch(config.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status}`);
  }
}

/**
 * Send alert to generic webhook
 */
async function sendToWebhook(alert: Alert, config: WebhookConfig): Promise<void> {
  const payload = {
    id: alert.id,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    source: alert.source,
    metadata: alert.metadata,
    timestamp: alert.created_at,
  };

  const response = await fetch(config.url, {
    method: config.method,
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body: config.method === 'POST' ? JSON.stringify(payload) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
}

/**
 * Send alert to Discord
 */
async function sendToDiscord(alert: Alert, config: DiscordConfig): Promise<void> {
  const severityColor = {
    critical: 0xFF0000,
    high: 0xFF9500,
    medium: 0xFFCC00,
    low: 0x36A64F,
  };

  const payload = {
    username: config.username || 'StdOut',
    avatar_url: config.avatar_url,
    embeds: [
      {
        color: severityColor[alert.severity],
        title: alert.title,
        description: alert.message,
        fields: [
          { name: 'Severity', value: alert.severity.toUpperCase(), inline: true },
          { name: 'Source', value: alert.source, inline: true },
        ],
        footer: { text: 'StdOut Observatory' },
        timestamp: new Date(alert.created_at).toISOString(),
      },
    ],
  };

  const response = await fetch(config.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook returned ${response.status}`);
  }
}

/**
 * Check if alert should be suppressed (deduplication + suppression windows)
 */
async function isAlertSuppressed(alert: Alert, userId: string): Promise<boolean> {
  const db = getSqlite();

  // Check for duplicate fingerprint in last 1 hour
  if (alert.fingerprint) {
    const duplicate = db.prepare(`
      SELECT id FROM alerts
      WHERE fingerprint = ? AND created_at > ?
      LIMIT 1
    `).get(alert.fingerprint, Date.now() - 3600000);

    if (duplicate) {
      return true; // Duplicate alert
    }
  }

  // Check for suppression windows (future feature)
  // TODO: Implement suppression windows table
  // - suppress_deployments: Mute alerts during deploy
  // - suppress_maintenance: Mute during maintenance window

  return false;
}

/**
 * Get all alert routes for a user
 */
export function getAlertRoutes(_userId?: string): AlertRoute[] {
  const db = getSqlite();

  try {
    const rows = db.prepare(`
      SELECT * FROM alert_routes ORDER BY name ASC
    `).all() as Array<{
      id: string;
      user_id?: string;
      name: string;
      type: string;
      config: string;
      enabled: number;
      min_severity: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      type: row.type as any,
      config: JSON.parse(row.config),
      enabled: Boolean(row.enabled),
      min_severity: row.min_severity as any,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Create or update an alert route
 */
export function upsertAlertRoute(route: Omit<AlertRoute, 'created_at' | 'updated_at'>): void {
  const db = getSqlite();

  // Create table if it doesn't exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS alert_routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_severity TEXT NOT NULL DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO alert_routes
    (id, name, type, config, enabled, min_severity, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM alert_routes WHERE id = ?), ?), ?)
  `).run(
    route.id,
    route.name,
    route.type,
    JSON.stringify(route.config),
    route.enabled ? 1 : 0,
    route.min_severity,
    route.id,
    now,
    now
  );
}

/**
 * Delete an alert route
 */
export function deleteAlertRoute(routeId: string, _userId?: string): void {
  const db = getSqlite();
  db.prepare(`DELETE FROM alert_routes WHERE id = ?`).run(routeId);
}

/**
 * Get recent alerts
 */
export function getRecentAlerts(userId: string, limit: number = 50): Alert[] {
  const db = getSqlite();

  try {
    const rows = db.prepare(`
      SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Array<{
      id: string;
      severity: string;
      title: string;
      message: string;
      source: string;
      metadata: string | null;
      fingerprint: string | null;
      created_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      severity: row.severity as any,
      title: row.title,
      message: row.message,
      source: row.source,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      fingerprint: row.fingerprint || undefined,
      created_at: row.created_at,
    }));
  } catch {
    return [];
  }
}
