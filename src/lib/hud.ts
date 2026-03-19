import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from './db';
import { eq, and, desc, gt } from 'drizzle-orm';
import { notify } from './notify';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

// --- Check Execution ---

interface CheckResult {
  status: 'healthy' | 'degraded' | 'down';
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
}

export async function executeCheck(monitor: typeof tenantSchema.monitors.$inferSelect): Promise<CheckResult> {
  switch (monitor.type) {
    case 'http':
      return checkHTTP(monitor.target, monitor.timeoutMs, monitor.expectedStatus || 200);
    case 'tcp':
      return checkTCP(monitor.target, monitor.timeoutMs);
    default:
      return { status: 'down', responseTimeMs: 0, error: `Unsupported check type: ${monitor.type}` };
  }
}

async function checkHTTP(url: string, timeoutMs: number, expectedStatus: number): Promise<CheckResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ status: 'down', responseTimeMs: timeoutMs, error: 'Timeout' });
    }, timeoutMs);

    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, {
        timeout: timeoutMs,
        rejectUnauthorized: false, // Allow self-signed certs
        headers: { 'User-Agent': 'StdOut-HUD/1.0' },
      }, (res) => {
        clearTimeout(timeout);
        const elapsed = Date.now() - start;
        const code = res.statusCode || 0;

        // Drain body
        res.resume();

        if (code === expectedStatus) {
          const status = elapsed > (timeoutMs * 0.8) ? 'degraded' : 'healthy';
          resolve({ status, responseTimeMs: elapsed, statusCode: code });
        } else if (code >= 200 && code < 400) {
          // Got a response, but not the expected code — degraded
          resolve({ status: 'degraded', responseTimeMs: elapsed, statusCode: code, error: `Expected ${expectedStatus}, got ${code}` });
        } else {
          resolve({ status: 'down', responseTimeMs: elapsed, statusCode: code, error: `HTTP ${code}` });
        }
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ status: 'down', responseTimeMs: Date.now() - start, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        clearTimeout(timeout);
        resolve({ status: 'down', responseTimeMs: timeoutMs, error: 'Timeout' });
      });
    } catch (err: any) {
      clearTimeout(timeout);
      resolve({ status: 'down', responseTimeMs: Date.now() - start, error: err.message });
    }
  });
}

async function checkTCP(target: string, timeoutMs: number): Promise<CheckResult> {
  const start = Date.now();
  const [host, portStr] = target.split(':');
  const port = parseInt(portStr) || 80;

  return new Promise((resolve) => {
    const socket = new net.Socket();

    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ status: 'down', responseTimeMs: timeoutMs, error: 'Timeout' });
    }, timeoutMs);

    socket.connect(port, host, () => {
      clearTimeout(timeout);
      const elapsed = Date.now() - start;
      socket.destroy();
      const status = elapsed > (timeoutMs * 0.8) ? 'degraded' : 'healthy';
      resolve({ status, responseTimeMs: elapsed });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ status: 'down', responseTimeMs: Date.now() - start, error: err.message });
    });
  });
}

// --- Check Loop ---

const checkTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

export function startMonitor(userId: string, monitorId: string) {
  stopMonitor(monitorId); // clear any existing timer

  const db = getTenantDb(userId);
  const monitor = db.select().from(tenantSchema.monitors)
    .where(eq(tenantSchema.monitors.id, monitorId)).get();

  if (!monitor || monitor.paused || monitor.maintenance) return;

  // Run immediately
  runCheck(userId, monitorId);

  // Then on interval
  const timer = setInterval(() => {
    runCheck(userId, monitorId);
  }, monitor.intervalSeconds * 1000);

  checkTimers.set(monitorId, timer);
}

export function stopMonitor(monitorId: string) {
  const timer = checkTimers.get(monitorId);
  if (timer) {
    clearInterval(timer);
    checkTimers.delete(monitorId);
  }
}

export function stopAllMonitors() {
  for (const [id, timer] of checkTimers) {
    clearInterval(timer);
  }
  checkTimers.clear();
}

async function runCheck(userId: string, monitorId: string) {
  const db = getTenantDb(userId);
  const monitor = db.select().from(tenantSchema.monitors)
    .where(eq(tenantSchema.monitors.id, monitorId)).get();

  if (!monitor || monitor.paused || monitor.maintenance) return;

  const result = await executeCheck(monitor);
  const now = new Date();

  // Record check result
  db.insert(tenantSchema.checkResults).values({
    id: nanoid(),
    monitorId,
    status: result.status,
    responseTimeMs: result.responseTimeMs,
    statusCode: result.statusCode || null,
    error: result.error || null,
    checkedAt: now,
  }).run();

  // Update monitor state + detect transitions
  const previousStatus = monitor.currentStatus;
  let newFailures = monitor.consecutiveFailures;
  let newStatus = monitor.currentStatus;

  if (result.status === 'down') {
    newFailures++;
    if (newFailures >= monitor.retries) {
      newStatus = 'down';
    }
  } else if (result.status === 'degraded') {
    newFailures = 0;
    newStatus = 'degraded';
  } else {
    newFailures = 0;
    newStatus = 'healthy';
  }

  db.update(tenantSchema.monitors).set({
    currentStatus: newStatus,
    consecutiveFailures: newFailures,
    lastCheckedAt: now,
    lastResponseMs: result.responseTimeMs,
    updatedAt: now,
  }).where(eq(tenantSchema.monitors.id, monitorId)).run();

  // --- State transition handling ---

  // Healthy/Degraded → Down: auto-create incident + notify
  if (newStatus === 'down' && previousStatus !== 'down') {
    const incidentId = nanoid();
    const errorDetail = result.error || `${monitor.type} check failed`;
    const title = `${monitor.name} is down`;
    const description = [
      `**Service:** ${monitor.name}`,
      `**Type:** ${monitor.type}`,
      `**Target:** ${monitor.target}`,
      `**Error:** ${errorDetail}`,
      `**Last successful:** ${monitor.lastCheckedAt ? monitor.lastCheckedAt.toISOString() : 'never'}`,
      `**Consecutive failures:** ${newFailures}`,
      '',
      '*Auto-created by HUD monitor.*',
    ].join('\n');

    db.insert(tenantSchema.incidents).values({
      id: incidentId,
      userId,
      stackId: monitor.stackId || null,
      title,
      description,
      severity: 'high',
      status: 'active',
      tags: `hud,${monitor.type},auto`,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Fire notifications
    notify(userId, {
      event: 'service_down',
      title,
      body: `${monitor.name} (${monitor.type}://${monitor.target}) failed ${newFailures} consecutive checks. ${errorDetail}`,
      url: `/app/incidents/${incidentId}`,
    }).catch(() => {}); // non-blocking

    notify(userId, {
      event: 'incident_created',
      title,
      body: `Auto-created incident for ${monitor.name}. ${errorDetail}`,
      url: `/app/incidents/${incidentId}`,
    }).catch(() => {});
  }

  // Down → Healthy: add recovery note to most recent auto-incident + notify
  if (newStatus === 'healthy' && previousStatus === 'down') {
    // Find the most recent auto-created incident for this monitor
    const recentIncident = db.select().from(tenantSchema.incidents)
      .where(and(
        eq(tenantSchema.incidents.userId, userId),
        eq(tenantSchema.incidents.status, 'active'),
      ))
      .orderBy(desc(tenantSchema.incidents.createdAt))
      .all()
      .find(i => i.title === `${monitor.name} is down` && i.tags?.includes('hud'));

    if (recentIncident) {
      // Calculate downtime
      const downSince = recentIncident.createdAt;
      const downtimeMs = now.getTime() - downSince.getTime();
      const downtimeMins = Math.round(downtimeMs / 60000);
      const downtimeStr = downtimeMins >= 60
        ? `${Math.floor(downtimeMins / 60)}h ${downtimeMins % 60}m`
        : `${downtimeMins}m`;

      // Add resolution
      db.insert(tenantSchema.resolutions).values({
        id: nanoid(),
        incidentId: recentIncident.id,
        userId,
        content: `Service recovered automatically.\n\n**Downtime:** ${downtimeStr}\n**Recovered at:** ${now.toISOString()}\n\n*Auto-resolved by HUD monitor.*`,
        createdAt: now,
      }).run();

      // Mark incident as resolved
      db.update(tenantSchema.incidents).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(tenantSchema.incidents.id, recentIncident.id)).run();
    }

    // Fire recovery notification
    notify(userId, {
      event: 'service_recovered',
      title: `${monitor.name} recovered`,
      body: `${monitor.name} (${monitor.type}://${monitor.target}) is back up. Response: ${result.responseTimeMs}ms.`,
      url: '/app/hud',
    }).catch(() => {});
  }

  // Update daily aggregation
  const dateStr = now.toISOString().split('T')[0];
  const existing = db.select().from(tenantSchema.uptimeDaily)
    .where(and(
      eq(tenantSchema.uptimeDaily.monitorId, monitorId),
      eq(tenantSchema.uptimeDaily.date, dateStr)
    )).get();

  if (existing) {
    const newTotal = existing.totalChecks + 1;
    const newSuccess = existing.successfulChecks + (result.status !== 'down' ? 1 : 0);
    const newAvg = existing.avgResponseMs
      ? Math.round((existing.avgResponseMs * existing.totalChecks + result.responseTimeMs) / newTotal)
      : result.responseTimeMs;

    db.update(tenantSchema.uptimeDaily).set({
      totalChecks: newTotal,
      successfulChecks: newSuccess,
      avgResponseMs: newAvg,
    }).where(and(
      eq(tenantSchema.uptimeDaily.monitorId, monitorId),
      eq(tenantSchema.uptimeDaily.date, dateStr)
    )).run();
  } else {
    db.insert(tenantSchema.uptimeDaily).values({
      monitorId,
      date: dateStr,
      totalChecks: 1,
      successfulChecks: result.status !== 'down' ? 1 : 0,
      avgResponseMs: result.responseTimeMs,
      p95ResponseMs: result.responseTimeMs,
    }).run();
  }
}

// --- Startup: resume all monitors ---

export function resumeAllMonitors() {
  // This is called on server startup to restart check loops
  // We need to iterate all users and their monitors
  // For self-host mode, there's one user; for SaaS, iterate all
  // For now, monitors are started on-demand when the HUD page is viewed
}

// --- Query helpers ---

export function getRecentChecks(userId: string, monitorId: string, limit = 60) {
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.checkResults)
    .where(eq(tenantSchema.checkResults.monitorId, monitorId))
    .orderBy(desc(tenantSchema.checkResults.checkedAt))
    .limit(limit)
    .all()
    .reverse(); // chronological order
}

export function getUptimeStats(userId: string, monitorId: string, days = 30) {
  const db = getTenantDb(userId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const rows = db.select().from(tenantSchema.uptimeDaily)
    .where(and(
      eq(tenantSchema.uptimeDaily.monitorId, monitorId),
      gt(tenantSchema.uptimeDaily.date, cutoffStr)
    ))
    .all();

  const totalChecks = rows.reduce((s, r) => s + r.totalChecks, 0);
  const successChecks = rows.reduce((s, r) => s + r.successfulChecks, 0);
  const uptimePercent = totalChecks > 0 ? (successChecks / totalChecks) * 100 : 0;

  const avgResponse = rows.length > 0
    ? Math.round(rows.reduce((s, r) => s + (r.avgResponseMs || 0), 0) / rows.length)
    : 0;

  return { uptimePercent, avgResponse, days: rows };
}
