/**
 * Alert Router — Unified notification dispatch for Windlass
 *
 * Evaluates service state against schedule, checks suppression rules,
 * and dispatches alerts through configured channels (email, Telegram, webhook).
 */

import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from './db';
import { eq, and, desc } from 'drizzle-orm';
import { encrypt, decrypt } from './crypto';

// --- Channel CRUD ---

export function createChannel(
  userId: string,
  type: 'email' | 'telegram' | 'webhook',
  name: string,
  config: Record<string, string>,
): string {
  const db = getTenantDb(userId);
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

  db.insert(tenantSchema.alertChannels).values({
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
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.alertChannels)
    .where(eq(tenantSchema.alertChannels.userId, userId))
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
  const db = getTenantDb(userId);
  // Also delete associated rules
  db.delete(tenantSchema.alertRules)
    .where(and(eq(tenantSchema.alertRules.userId, userId), eq(tenantSchema.alertRules.channelId, channelId)))
    .run();
  const result = db.delete(tenantSchema.alertChannels)
    .where(and(eq(tenantSchema.alertChannels.id, channelId), eq(tenantSchema.alertChannels.userId, userId)))
    .run();
  return result.changes > 0;
}

export function toggleChannel(userId: string, channelId: string, enabled: boolean): void {
  const db = getTenantDb(userId);
  db.update(tenantSchema.alertChannels)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(tenantSchema.alertChannels.id, channelId), eq(tenantSchema.alertChannels.userId, userId)))
    .run();
}

// --- Rules CRUD ---

export function createRule(
  userId: string,
  channelId: string,
  serviceId: string | null,
  severityMin: 'info' | 'warning' | 'critical',
): string {
  const db = getTenantDb(userId);
  const id = nanoid();
  db.insert(tenantSchema.alertRules).values({
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
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.alertRules)
    .where(eq(tenantSchema.alertRules.userId, userId))
    .all();
}

export function deleteRule(userId: string, ruleId: string): boolean {
  const db = getTenantDb(userId);
  const result = db.delete(tenantSchema.alertRules)
    .where(and(eq(tenantSchema.alertRules.id, ruleId), eq(tenantSchema.alertRules.userId, userId)))
    .run();
  return result.changes > 0;
}

// --- Alert Event History ---

export function listAlertEvents(userId: string, limit = 50, serviceId?: string) {
  const db = getTenantDb(userId);
  if (serviceId) {
    return db.select().from(tenantSchema.alertEvents)
      .where(and(eq(tenantSchema.alertEvents.userId, userId), eq(tenantSchema.alertEvents.serviceId, serviceId)))
      .orderBy(desc(tenantSchema.alertEvents.createdAt))
      .limit(limit)
      .all();
  }
  return db.select().from(tenantSchema.alertEvents)
    .where(eq(tenantSchema.alertEvents.userId, userId))
    .orderBy(desc(tenantSchema.alertEvents.createdAt))
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
  userId: string;
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
  const db = getTenantDb(input.userId);
  const eventId = nanoid();
  const now = new Date();

  // --- Check suppression ---
  let suppressed = false;
  let suppressionReason: string | null = null;

  if (input.serviceId) {
    const service = db.select().from(tenantSchema.windlassServices)
      .where(and(
        eq(tenantSchema.windlassServices.id, input.serviceId),
        eq(tenantSchema.windlassServices.userId, input.userId),
      ))
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
        const recentEvents = db.select().from(tenantSchema.alertEvents)
          .where(and(
            eq(tenantSchema.alertEvents.userId, input.userId),
            eq(tenantSchema.alertEvents.serviceId, input.serviceId),
          ))
          .orderBy(desc(tenantSchema.alertEvents.createdAt))
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
    const rules = db.select().from(tenantSchema.alertRules)
      .where(and(
        eq(tenantSchema.alertRules.userId, input.userId),
        eq(tenantSchema.alertRules.enabled, true),
      ))
      .all();

    const matchingRules = rules.filter(r => {
      // Global rule (serviceId = null) matches everything
      if (r.serviceId && r.serviceId !== input.serviceId) return false;
      return severityMeets(input.severity, r.severityMin);
    });

    // Get unique channels
    const channelIds = [...new Set(matchingRules.map(r => r.channelId))];
    const channels = db.select().from(tenantSchema.alertChannels)
      .where(and(
        eq(tenantSchema.alertChannels.userId, input.userId),
        eq(tenantSchema.alertChannels.enabled, true),
      ))
      .all()
      .filter(ch => channelIds.includes(ch.id));

    // Dispatch to each channel
    for (const channel of channels) {
      try {
        await dispatchToChannel(channel, input);
        channelsNotified.push(channel.id);
      } catch (err) {
        console.error(`Alert dispatch failed for channel ${channel.name}:`, err);
      }
    }
  }

  // --- Record event ---
  db.insert(tenantSchema.alertEvents).values({
    id: eventId,
    userId: input.userId,
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
  channel: any,
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
  const db = getTenantDb(userId);
  const channel = db.select().from(tenantSchema.alertChannels)
    .where(and(eq(tenantSchema.alertChannels.id, channelId), eq(tenantSchema.alertChannels.userId, userId)))
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
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function sendWindlassWeeklyDigest(
  userId: string,
  summary: { recoveredGbHours: number; serviceCount: number; weekLabel: string }
): Promise<void> {
  const db = getTenantDb(userId);
  const channels = db.select().from(tenantSchema.alertChannels)
    .where(and(
      eq(tenantSchema.alertChannels.userId, userId),
      eq(tenantSchema.alertChannels.enabled, true),
    ))
    .all()
    .filter(ch => ch.type === 'email' || ch.type === 'telegram');

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
    } catch (err) {
      console.error('Weekly digest dispatch failed:', err);
    }
  }
}
