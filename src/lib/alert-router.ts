/**
 * Alert Router — Unified notification dispatch for Windlass
 *
 * Evaluates service state against schedule, checks suppression rules,
 * and dispatches alerts through configured channels (email, Telegram, webhook).
 */

import { nanoid } from 'nanoid';
import { getDb, schema } from './db';
import { eq, and, desc } from 'drizzle-orm';
import { encrypt, decrypt } from './crypto';

// --- Channel CRUD ---

export function createChannel(
  userId: string,
  type: 'email' | 'telegram' | 'webhook',
  name: string,
  config: Record<string, string>,
): string {
  const db = getDb();
  const id = nanoid();
  const now = new Date();

  // Encrypt sensitive fields in config
  const safeConfig = { ...config };
  if (type === 'telegram' && safeConfig.bot_token) {
    safeConfig.bot_token = encrypt(safeConfig.bot_token);
  }
  if (type === 'webhook' && safeConfig.secret) {
    safeConfig.secret = encrypt(safeConfig.secret);
  }

  db.insert(schema.alertChannels).values({
    id,
    userId,
    type,
    name,
    config: JSON.stringify(safeConfig),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }).run();

  return id;
}

export function listChannels(userId: string) {
  const db = getDb();
  return db.select().from(schema.alertChannels)
    .all()
    .map(ch => ({
      ...ch,
      // Mask sensitive config values
      config: maskConfig(ch.type, JSON.parse(ch.config)),
    }));
}

function maskConfig(type: string, config: Record<string, string>): Record<string, string> {
  const safe = { ...config };
  if (type === 'telegram' && safe.bot_token) safe.bot_token = '********';
  if (type === 'webhook' && safe.secret) safe.secret = '********';
  return safe;
}

export function deleteChannel(userId: string, channelId: string): boolean {
  const db = getDb();
  // Also delete associated rules
  db.delete(schema.alertRules)
    .where(eq(schema.alertRules.channelId, channelId))
    .run();
  const result = db.delete(schema.alertChannels)
    .where(eq(schema.alertChannels.id, channelId))
    .run();
  return result.changes > 0;
}

export function toggleChannel(userId: string, channelId: string, enabled: boolean): void {
  const db = getDb();
  db.update(schema.alertChannels)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(schema.alertChannels.id, channelId))
    .run();
}

// --- Rules CRUD ---

export function createRule(
  userId: string,
  channelId: string,
  serviceId: string | null,
  severityMin: 'info' | 'warning' | 'critical',
): string {
  const db = getDb();
  const id = nanoid();
  db.insert(schema.alertRules).values({
    id,
    userId,
    serviceId,
    channelId,
    severityMin,
    enabled: true,
    createdAt: new Date(),
  }).run();
  return id;
}

export function listRules(userId: string) {
  const db = getDb();
  return db.select().from(schema.alertRules)
    .all();
}

export function deleteRule(userId: string, ruleId: string): boolean {
  const db = getDb();
  const result = db.delete(schema.alertRules)
    .where(eq(schema.alertRules.id, ruleId))
    .run();
  return result.changes > 0;
}

// --- Alert Event History ---

export function listAlertEvents(userId: string, limit = 50, serviceId?: string) {
  const db = getDb();
  if (serviceId) {
    return db.select().from(schema.alertEvents)
      .where(eq(schema.alertEvents.serviceId, serviceId))
      .orderBy(desc(schema.alertEvents.createdAt))
      .limit(limit)
      .all();
  }
  return db.select().from(schema.alertEvents)
    .orderBy(desc(schema.alertEvents.createdAt))
    .limit(limit)
    .all();
}

// --- Severity ordering ---

const SEVERITY_ORDER: Record<string, number> = { info: 0, warning: 1, critical: 2 };

function severityMeets(actual: string, minimum: string): boolean {
  return (SEVERITY_ORDER[actual] ?? 0) >= (SEVERITY_ORDER[minimum] ?? 0);
}

// --- Core: Fire Alert ---

export interface AlertInput {
  userId?: string;  // Optional in single-instance mode (Phase 1.1)
  serviceId: string | null;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail?: string;
}

/**
 * Evaluate suppression rules and dispatch alert to configured channels.
 * Returns the event ID and whether it was suppressed.
 */
export async function fireAlert(input: AlertInput): Promise<{ eventId: string; suppressed: boolean; channelsNotified: string[] }> {
  const db = getDb();
  const eventId = nanoid();
  const now = new Date();

  // --- Check suppression ---
  let suppressed = false;
  let suppressionReason: string | null = null;

  if (input.serviceId) {
    const service = db.select().from(schema.windlassServices)
      .where(eq(schema.windlassServices.id, input.serviceId))
      .get();

    if (service) {
      // Manual override active? Suppress.
      if (service.overrideUntil && new Date(service.overrideUntil) > now) {
        suppressed = true;
        suppressionReason = 'override_active';
      }

      // Outside schedule window for scheduled services? Suppress.
      if (!suppressed && service.classification === 'scheduled' && service.expectedState === 'stopped') {
        suppressed = true;
        suppressionReason = 'outside_schedule';
      }

      // Manual services never alert
      if (!suppressed && service.classification === 'manual') {
        suppressed = true;
        suppressionReason = 'manual_service';
      }

      // Flap suppression: check for recent opposite event in last 5 minutes
      if (!suppressed && (input.eventType === 'service_down' || input.eventType === 'service_up')) {
        const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
        const recentEvents = db.select().from(schema.alertEvents)
          .where(eq(schema.alertEvents.serviceId, input.serviceId))
          .orderBy(desc(schema.alertEvents.createdAt))
          .limit(3)
          .all();

        // If the last event was the opposite state change within 5 min, it's a flap
        if (recentEvents.length > 0) {
          const last = recentEvents[0];
          const lastTime = new Date(last.createdAt);
          if (lastTime > fiveMinAgo) {
            const oppositeMap: Record<string, string> = { service_down: 'service_up', service_up: 'service_down' };
            if (last.eventType === oppositeMap[input.eventType]) {
              suppressed = true;
              suppressionReason = 'flap_suppression';
            }
          }
        }
      }
    }
  }

  // --- Find matching channels ---
  const channelsNotified: string[] = [];

  if (!suppressed) {
    // Get all enabled rules matching this service + severity
    const rules = db.select().from(schema.alertRules)
      .where(eq(schema.alertRules.enabled, true))
      .all();

    const matchingRules = rules.filter(r => {
      // Global rule (serviceId = null) matches everything
      if (r.serviceId && r.serviceId !== input.serviceId) return false;
      return severityMeets(input.severity, r.severityMin);
    });

    // Get unique channels
    const channelIds = [...new Set(matchingRules.map(r => r.channelId))];
    const channels = db.select().from(schema.alertChannels)
      .where(eq(schema.alertChannels.enabled, true))
      .all()
      .filter(ch => channelIds.includes(ch.id));

    // Dispatch to each channel
    for (const channel of channels) {
      try {
        await dispatchToChannel(channel, input);
        channelsNotified.push(channel.id);
      } catch (error) {
        console.error(`Alert dispatch failed for channel ${channel.name}:`, error);
      }
    }
  }

  // --- Record event ---
  db.insert(schema.alertEvents).values({
    id: eventId,
    userId: input.userId || null,  // Nullable in single-instance mode
    serviceId: input.serviceId,
    eventType: input.eventType,
    severity: input.severity,
    title: input.title,
    detail: input.detail || null,
    suppressed,
    suppressionReason,
    channelsNotified: JSON.stringify(channelsNotified),
    createdAt: now,
  }).run();

  return { eventId, suppressed, channelsNotified };
}

// --- Channel Dispatch ---

async function dispatchToChannel(
  channel: unknown,
  alert: AlertInput,
): Promise<void> {
  const config = JSON.parse(channel.config);
  const severityEmoji: Record<string, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };
  const emoji = severityEmoji[alert.severity] || 'ℹ️';

  if (channel.type === 'email') {
    // Use Resend if available
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'StdOut Alerts <alerts@stdout.seayniclabs.com>',
        to: config.email,
        subject: `${emoji} [${alert.severity.toUpperCase()}] ${alert.title}`,
        text: `${alert.title}\n\n${alert.detail || ''}\n\nService: ${alert.serviceId || 'system'}\nTime: ${new Date().toISOString()}`,
      }),
      signal: AbortSignal.timeout(10000),
    });
  }

  if (channel.type === 'telegram') {
    const botToken = decrypt(config.bot_token) || config.bot_token;
    const chatId = config.chat_id;
    if (!botToken || !chatId) return;

    const message = `${emoji} *${alert.severity.toUpperCase()}* — ${alert.title}\n\n${alert.detail || ''}\n\n_Service: ${alert.serviceId || 'system'}_`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10000),
    });
  }

  if (channel.type === 'webhook') {
    const url = config.url;
    if (!url) return;

    const payload = {
      event: alert.eventType,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      serviceId: alert.serviceId,
      timestamp: new Date().toISOString(),
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // HMAC signing if secret is configured
    if (config.secret) {
      const crypto = await import('node:crypto');
      const secret = decrypt(config.secret) || config.secret;
      const signature = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload)).digest('hex');
      headers['X-StdOut-Signature'] = `sha256=${signature}`;
    }

    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  }
}

// --- Test Channel ---

export async function testChannel(userId: string, channelId: string): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const channel = db.select().from(schema.alertChannels)
    .where(eq(schema.alertChannels.id, channelId))
    .get();

  if (!channel) return { success: false, error: 'Channel not found' };

  try {
    await dispatchToChannel(channel, {
      userId,
      serviceId: null,
      eventType: 'test',
      severity: 'info',
      title: 'Test alert from StdOut',
      detail: 'This is a test notification to verify your alert channel is working.',
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendWindlassWeeklyDigest(
  userId: string,
  summary: { recoveredGbHours: number; serviceCount: number; weekLabel: string },
  opts?: { skipCooldown?: boolean },
): Promise<{ sent: boolean; skipped?: string }> {
  const db = getDb();

  if (!opts?.skipCooldown) {
    const cfg = db.select().from(schema.windlassConfig)
      .get();
    const last = cfg?.lastWeeklyDigestAt ? new Date(cfg.lastWeeklyDigestAt).getTime() : 0;
    if (last && Date.now() - last < 6 * 24 * 60 * 60 * 1000) {
      return { sent: false, skipped: 'weekly_digest_cooldown' };
    }
  }

  const channels = db.select().from(schema.alertChannels)
    .where(eq(schema.alertChannels.enabled, true))
    .all()
    .filter(ch => ch.type === 'email' || ch.type === 'telegram');

  if (channels.length === 0) {
    return { sent: false, skipped: 'no_channels' };
  }

  const title = `Windlass Weekly Summary (${summary.weekLabel})`;
  const detail = `Recovered ${summary.recoveredGbHours.toFixed(2)} GB-hours across ${summary.serviceCount} services.`;

  for (const channel of channels) {
    try {
      await dispatchToChannel(channel, {
        userId,
        serviceId: null,
        eventType: 'weekly_summary',
        severity: 'info',
        title,
        detail,
      });
    } catch (error) {
      console.error('Weekly digest dispatch failed:', error);
    }
  }

  return { sent: true };
}
