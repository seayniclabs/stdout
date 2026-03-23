import { getCentralDb, getTenantDb, centralSchema, tenantSchema } from './db';
import { eq, and, desc, gt } from 'drizzle-orm';
import { getUptimeStats } from './hud';
import fs from 'node:fs';

interface DigestData {
  period: string;
  incidentsCreated: number;
  incidentsResolved: number;
  incidentsActive: number;
  criticalCount: number;
  topIncidents: Array<{ title: string; severity: string; status: string; id: string }>;
  monitorsTotal: number;
  monitorsHealthy: number;
  monitorsDown: number;
  uptimeAvg: number;
  slowestServices: Array<{ name: string; avgMs: number; uptimePct: number }>;
  docsCreated: number;
  resolutionsAdded: number;
}

export function generateDigest(userId: string): DigestData | null {
  const db = getTenantDb(userId);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Incidents this week
  const allIncidents = db.select().from(tenantSchema.incidents)
    .where(eq(tenantSchema.incidents.userId, userId))
    .all();

  const weekIncidents = allIncidents.filter(i => i.createdAt >= weekAgo);
  const resolvedThisWeek = allIncidents.filter(i => i.resolvedAt && i.resolvedAt >= weekAgo);
  const activeNow = allIncidents.filter(i => i.status !== 'resolved');
  const criticalThisWeek = weekIncidents.filter(i => i.severity === 'critical');

  // Top incidents (most recent, prioritize active)
  const topIncidents = [...activeNow, ...weekIncidents]
    .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i) // dedupe
    .slice(0, 5)
    .map(i => ({ title: i.title, severity: i.severity, status: i.status, id: i.id }));

  // Monitors
  const monitors = db.select().from(tenantSchema.monitors)
    .where(eq(tenantSchema.monitors.userId, userId))
    .all();

  const monitorsHealthy = monitors.filter(m => m.currentStatus === 'healthy').length;
  const monitorsDown = monitors.filter(m => m.currentStatus === 'down').length;

  // Uptime and response times
  const monitorStats = monitors.map(m => {
    const stats = getUptimeStats(userId, m.id, 7);
    return { name: m.name, avgMs: stats.avgResponse, uptimePct: stats.uptimePercent };
  });

  const uptimeAvg = monitorStats.length > 0
    ? monitorStats.reduce((s, m) => s + m.uptimePct, 0) / monitorStats.length
    : 0;

  const slowest = monitorStats
    .filter(m => m.avgMs > 0)
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 3);

  // Docs and resolutions this week
  const docs = db.select().from(tenantSchema.docs)
    .where(eq(tenantSchema.docs.userId, userId))
    .all()
    .filter(d => d.createdAt >= weekAgo);

  const resolutions = db.select().from(tenantSchema.resolutions)
    .where(eq(tenantSchema.resolutions.userId, userId))
    .all()
    .filter(r => r.createdAt >= weekAgo);

  // Skip digest if nothing happened
  if (weekIncidents.length === 0 && monitors.length === 0 && docs.length === 0) {
    return null;
  }

  return {
    period: `${weekAgo.toLocaleDateString()} – ${now.toLocaleDateString()}`,
    incidentsCreated: weekIncidents.length,
    incidentsResolved: resolvedThisWeek.length,
    incidentsActive: activeNow.length,
    criticalCount: criticalThisWeek.length,
    topIncidents,
    monitorsTotal: monitors.length,
    monitorsHealthy,
    monitorsDown,
    uptimeAvg,
    slowestServices: slowest,
    docsCreated: docs.length,
    resolutionsAdded: resolutions.length,
  };
}

export function renderDigestHTML(data: DigestData, appUrl: string): string {
  const severityColor: Record<string, string> = {
    critical: '#EF4444', high: '#EAB308', medium: '#FACC15', low: '#22C55E',
  };

  const incidentRows = data.topIncidents.map(i => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1F1F35;">
        <a href="${appUrl}/app/incidents/${i.id}" style="color:#FB923C;text-decoration:none;">${esc(i.title)}</a>
      </td>
      <td style="padding:6px 12px;border-bottom:1px solid #1F1F35;color:${severityColor[i.severity] || '#9090A8'};font-family:monospace;font-size:12px;">${i.severity}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1F1F35;font-family:monospace;font-size:12px;color:#9090A8;">${i.status}</td>
    </tr>
  `).join('');

  const slowRows = data.slowestServices.map(s => `
    <tr>
      <td style="padding:4px 12px;border-bottom:1px solid #1F1F35;">${esc(s.name)}</td>
      <td style="padding:4px 12px;border-bottom:1px solid #1F1F35;font-family:monospace;font-size:12px;">${s.avgMs}ms</td>
      <td style="padding:4px 12px;border-bottom:1px solid #1F1F35;font-family:monospace;font-size:12px;color:${s.uptimePct >= 99.9 ? '#22C55E' : s.uptimePct >= 99 ? '#9090A8' : '#EF4444'}">${s.uptimePct.toFixed(2)}%</td>
    </tr>
  `).join('');

  return `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,system-ui,sans-serif;background:#07070C;color:#F0F0F8;padding:32px 24px;">
      <div style="font-family:monospace;font-size:11px;color:#5A5A72;margin-bottom:20px;">StdOut Weekly Digest</div>
      <h1 style="font-size:20px;font-weight:700;margin:0 0 4px;">Your week in review</h1>
      <p style="font-size:13px;color:#9090A8;margin:0 0 24px;">${esc(data.period)}</p>

      <!-- Stats grid -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="text-align:center;padding:16px;background:#0E0E18;border:1px solid #1F1F35;">
            <div style="font-size:28px;font-weight:700;font-family:monospace;color:${data.incidentsActive > 0 ? '#EF4444' : '#22C55E'}">${data.incidentsActive}</div>
            <div style="font-size:11px;color:#5A5A72;text-transform:uppercase;letter-spacing:0.05em;">Active</div>
          </td>
          <td style="text-align:center;padding:16px;background:#0E0E18;border:1px solid #1F1F35;">
            <div style="font-size:28px;font-weight:700;font-family:monospace;">${data.incidentsCreated}</div>
            <div style="font-size:11px;color:#5A5A72;text-transform:uppercase;letter-spacing:0.05em;">New this week</div>
          </td>
          <td style="text-align:center;padding:16px;background:#0E0E18;border:1px solid #1F1F35;">
            <div style="font-size:28px;font-weight:700;font-family:monospace;color:#22C55E">${data.incidentsResolved}</div>
            <div style="font-size:11px;color:#5A5A72;text-transform:uppercase;letter-spacing:0.05em;">Resolved</div>
          </td>
        </tr>
      </table>

      ${data.topIncidents.length > 0 ? `
        <h2 style="font-size:13px;font-weight:600;color:#9090A8;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #1F1F35;padding-bottom:6px;margin-bottom:8px;">Incidents</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
          ${incidentRows}
        </table>
      ` : ''}

      ${data.monitorsTotal > 0 ? `
        <h2 style="font-size:13px;font-weight:600;color:#9090A8;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #1F1F35;padding-bottom:6px;margin-bottom:8px;">Infrastructure</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <tr>
            <td style="text-align:center;padding:12px;background:#0E0E18;border:1px solid #1F1F35;">
              <div style="font-size:22px;font-weight:700;font-family:monospace;color:#22C55E">${data.monitorsHealthy}</div>
              <div style="font-size:10px;color:#5A5A72;text-transform:uppercase;">Healthy</div>
            </td>
            <td style="text-align:center;padding:12px;background:#0E0E18;border:1px solid #1F1F35;">
              <div style="font-size:22px;font-weight:700;font-family:monospace;color:${data.monitorsDown > 0 ? '#EF4444' : '#5A5A72'}">${data.monitorsDown}</div>
              <div style="font-size:10px;color:#5A5A72;text-transform:uppercase;">Down</div>
            </td>
            <td style="text-align:center;padding:12px;background:#0E0E18;border:1px solid #1F1F35;">
              <div style="font-size:22px;font-weight:700;font-family:monospace;color:${data.uptimeAvg >= 99.9 ? '#22C55E' : '#EAB308'}">${data.uptimeAvg.toFixed(2)}%</div>
              <div style="font-size:10px;color:#5A5A72;text-transform:uppercase;">Avg Uptime</div>
            </td>
          </tr>
        </table>

        ${slowRows.length > 0 ? `
          <p style="font-size:12px;color:#5A5A72;margin-bottom:4px;">Slowest services:</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
            ${slowRows}
          </table>
        ` : ''}
      ` : ''}

      ${data.docsCreated > 0 || data.resolutionsAdded > 0 ? `
        <h2 style="font-size:13px;font-weight:600;color:#9090A8;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #1F1F35;padding-bottom:6px;margin-bottom:8px;">Knowledge Base</h2>
        <p style="font-size:13px;color:#A0A0B8;">
          ${data.docsCreated > 0 ? `${data.docsCreated} doc${data.docsCreated > 1 ? 's' : ''} added` : ''}
          ${data.docsCreated > 0 && data.resolutionsAdded > 0 ? ' · ' : ''}
          ${data.resolutionsAdded > 0 ? `${data.resolutionsAdded} resolution${data.resolutionsAdded > 1 ? 's' : ''} logged` : ''}
        </p>
      ` : ''}

      <div style="margin-top:28px;text-align:center;">
        <a href="${appUrl}/app" style="display:inline-block;padding:10px 24px;background:#C2410C;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open StdOut</a>
      </div>

      <div style="margin-top:32px;text-align:center;font-family:monospace;font-size:10px;color:#5A5A72;">
        StdOut by Seaynic Labs · <a href="${appUrl}/app/settings" style="color:#5A5A72;">Manage notifications</a>
      </div>
    </div>
  `;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Send digest to all users with email notifications ---

export async function sendWeeklyDigests(): Promise<number> {
  let apiKey = '';
  try {
    const keyPath = process.env.RESEND_API_KEY_FILE || '/run/secrets/resend_api_key';
    apiKey = fs.readFileSync(keyPath, 'utf8').trim();
  } catch {
    console.error('Resend API key not found — skipping weekly digest');
    return 0;
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const allUsers = getCentralDb().select().from(centralSchema.users).all();
  let sent = 0;

  for (const user of allUsers) {
    // Check if user has email notifications enabled
    const db = getTenantDb(user.id);
    const notifs = db.select().from(tenantSchema.notificationPreferences)
      .where(and(
        eq(tenantSchema.notificationPreferences.userId, user.id),
        eq(tenantSchema.notificationPreferences.enabled, true),
      ))
      .all();

    const hasEmail = notifs.some(n => n.channel === 'email');
    if (!hasEmail) continue;

    const emailDest = notifs.find(n => n.channel === 'email')?.destination;
    if (!emailDest) continue;

    const data = generateDigest(user.id);
    if (!data) continue; // nothing happened this week

    const html = renderDigestHTML(data, appUrl);

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'StdOut <noreply@stdout.app>',
          to: [emailDest],
          subject: `[StdOut] Weekly Digest — ${data.period}`,
          html,
        }),
      });
      sent++;
    } catch (err) {
      console.error(`Digest failed for ${user.id}:`, err);
    }
  }

  return sent;
}
