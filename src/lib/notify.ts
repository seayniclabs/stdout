import { getTenantDb, tenantSchema } from './db';
import { eq, and } from 'drizzle-orm';
import fs from 'node:fs';

export type NotifyEvent =
  | 'incident_created'
  | 'diagnosis_complete'
  | 'severity_critical'
  | 'backup_complete'
  | 'service_down'
  | 'service_recovered';

interface NotifyPayload {
  event: NotifyEvent;
  title: string;
  body: string;
  url?: string; // Link back to the incident/doc in StdOut
  metadata?: Record<string, unknown>;
}

/**
 * Send notifications for an event to all matching channels for a user.
 * Runs async — does not block the request.
 */
export async function notify(userId: string, payload: NotifyPayload): Promise<void> {
  const db = getTenantDb(userId);
  const prefs = db.select().from(tenantSchema.notificationPreferences)
    .where(and(
      eq(tenantSchema.notificationPreferences.userId, userId),
      eq(tenantSchema.notificationPreferences.enabled, true),
    ))
    .all();

  for (const pref of prefs) {
    let events: string[] = [];
    try { events = JSON.parse(pref.events); } catch { continue; }
    if (!events.includes(payload.event)) continue;

    try {
      if (pref.channel === 'email') {
        await sendEmail(pref.destination, payload);
      } else if (pref.channel === 'webhook') {
        await sendWebhook(pref.destination, payload);
      }
    } catch (err) {
      console.error(`Notification failed [${pref.channel}] → ${pref.destination}:`, err);
    }
  }
}

async function sendEmail(to: string, payload: NotifyPayload): Promise<void> {
  let apiKey = '';
  try {
    const keyPath = process.env.RESEND_API_KEY_FILE || '/run/secrets/resend_api_key';
    apiKey = fs.readFileSync(keyPath, 'utf8').trim();
  } catch {
    console.error('Resend API key not found — skipping email notification');
    return;
  }

  if (!apiKey) return;

  const appUrl = process.env.APP_URL || 'https://stdout.seaynicroute.com';

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      <div style="font-size: 11px; color: #9090A8; font-family: monospace; margin-bottom: 16px;">StdOut</div>
      <h2 style="font-size: 16px; margin: 0 0 8px;">${escapeHtml(payload.title)}</h2>
      <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 16px;">${escapeHtml(payload.body)}</p>
      ${payload.url ? `<a href="${appUrl}${payload.url}" style="display: inline-block; padding: 8px 16px; background: #F97316; color: #fff; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600;">View in StdOut</a>` : ''}
    </div>
  `;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'StdOut <notifications@stdout.seayniclabs.com>',
      to: [to],
      subject: `[StdOut] ${payload.title}`,
      html,
    }),
  });
}

async function sendWebhook(url: string, payload: NotifyPayload): Promise<void> {
  const appUrl = process.env.APP_URL || 'https://stdout.seaynicroute.com';

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'StdOut/1.0' },
    body: JSON.stringify({
      event: payload.event,
      title: payload.title,
      body: payload.body,
      url: payload.url ? `${appUrl}${payload.url}` : null,
      metadata: payload.metadata || {},
      timestamp: new Date().toISOString(),
    }),
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
