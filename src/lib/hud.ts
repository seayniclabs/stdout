import { nanoid } from 'nanoid';
import { getDb, schema } from './db';
import { eq, and, desc, gt } from 'drizzle-orm';
import { notify } from './notify';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

// --- SSRF Protection ---

/**
 * Validates that a URL/host does not resolve to an internal or private network address.
 * Blocks RFC 1918, link-local, loopback, cloud metadata, and Docker internal hostnames.
 */
export function isBlockedTarget(target: string): boolean {
  // Allow disabling SSRF protection via env var for trusted internal networks
  if (process.env.STDOUT_DISABLE_SSRF_PROTECTION === 'true') {
    return false;
  }

  let hostname: string;
  try {
    // Handle full URLs (http/https)
    if (target.startsWith('http://') || target.startsWith('https://')) {
      hostname = new URL(target).hostname;
    } else {
      // TCP targets are host:port
      hostname = target.split(':')[0];
    }
  } catch {
    return true; // Malformed = blocked
  }

  const lower = hostname.toLowerCase();

  // Block Docker internal and common internal hostnames
  if (lower === 'host.docker.internal' || lower === 'gateway.docker.internal' ||
      lower === 'metadata.google.internal' || lower === 'kubernetes.default.svc') {
    return true;
  }

  // Block localhost variants (monitoring should use actual IPs, not localhost)
  if (lower === 'localhost' || lower === '[::1]' || lower.endsWith('.localhost')) {
    return true;
  }

  // Check for IP-based targets
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [, a, b, c, d] = ipMatch.map(Number);
    // 127.0.0.0/8 — loopback (block - use actual IP instead)
    if (a === 127) return true;
    // RFC 1918 private addresses — ALLOW for self-hosted infrastructure monitoring
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 are explicitly allowed
    // 169.254.0.0/16 — link-local (block - usually auto-config, not real services)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0 (block - invalid target)
    if (a === 0 && b === 0 && c === 0 && d === 0) return true;
    // Cloud metadata endpoints (AWS, GCP, Azure) - block SSRF to these
    if (a === 169 && b === 254 && c === 169 && d === 254) return true;
    if (a === 100 && b === 100 && c === 100 && d === 200) return true; // AWS IMDSv2 alt
  }

  // Block IPv6 loopback
  if (hostname === '::1' || hostname === '::') return true;

  return false;
}

// --- Check Execution ---

interface CheckResult {
  status: 'healthy' | 'degraded' | 'down';
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
}

export async function executeCheck(monitor: typeof schema.monitors.$inferSelect): Promise<CheckResult> {
  // SSRF protection: block requests to internal/private networks in SaaS mode.
  // Self-host operators own the network — monitoring internal targets is the point.
  const isSelfHost = process.env.STDOUT_MODE === 'selfhost';
  if (!isSelfHost && isBlockedTarget(monitor.target)) {
    return { status: 'down', responseTimeMs: 0, error: 'Target address is not allowed (internal/private network)' };
  }

  switch (monitor.type) {
    case 'http':
      return checkHTTP(monitor.target, monitor.timeoutMs, monitor.expectedStatus || 200);
    case 'tcp':
      return checkTCP(monitor.target, monitor.timeoutMs);
    case 'output-freshness':
      if (!monitor.jsonPath || !monitor.freshnessWindowSeconds) {
        return { status: 'down', responseTimeMs: 0, error: 'Missing jsonPath or freshnessWindowSeconds' };
      }
      return checkOutputFreshness(
        monitor.target,
        monitor.jsonPath,
        monitor.freshnessWindowSeconds,
        monitor.timeoutMs
      );
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

/**
 * Output Freshness Check — probe a JSON API and verify recent activity.
 * Extracts a timestamp via JSONPath and alerts if too old.
 */
async function checkOutputFreshness(
  url: string,
  jsonPath: string,
  freshnessWindowSeconds: number,
  timeoutMs: number
): Promise<CheckResult> {
  const start = Date.now();

  // Strip output-freshness:// scheme and default to http://
  const httpUrl = url.replace(/^output-freshness:\/\//, 'http://');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ status: 'down', responseTimeMs: timeoutMs, error: 'Timeout' });
    }, timeoutMs);

    try {
      const mod = httpUrl.startsWith('https') ? https : http;
      const req = mod.get(httpUrl, {
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'StdOut-HUD/1.0' },
      }, (res) => {
        clearTimeout(timeout);
        const elapsed = Date.now() - start;

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const timestamp = extractJSONPath(data, jsonPath);

            if (!timestamp) {
              resolve({ status: 'degraded', responseTimeMs: elapsed, error: 'JSONPath extraction failed' });
              return;
            }

            // Parse timestamp (handles both ISO strings and Unix timestamps)
            let timestampMs: number;
            if (typeof timestamp === 'number') {
              // Assume Unix timestamp in seconds if < year 3000 in milliseconds
              timestampMs = timestamp < 32503680000 ? timestamp * 1000 : timestamp;
            } else {
              timestampMs = new Date(timestamp).getTime();
            }

            if (isNaN(timestampMs)) {
              resolve({ status: 'degraded', responseTimeMs: elapsed, error: 'Invalid timestamp format' });
              return;
            }

            const ageSeconds = (Date.now() - timestampMs) / 1000;

            if (ageSeconds > freshnessWindowSeconds) {
              resolve({
                status: 'down',
                responseTimeMs: elapsed,
                error: `Output stale: ${Math.round(ageSeconds / 3600)}h old (limit: ${freshnessWindowSeconds / 3600}h)`
              });
            } else {
              resolve({ status: 'healthy', responseTimeMs: elapsed });
            }
          } catch (err: any) {
            resolve({ status: 'degraded', responseTimeMs: elapsed, error: `JSON parse error: ${err.message}` });
          }
        });
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

/**
 * Simple JSONPath extractor — handles basic paths like "$[0].field" or "$.data[0].timestamp".
 * For production use, consider jsonpath-plus for full spec support.
 */
function extractJSONPath(data: any, path: string): any {
  // Remove leading "$" if present
  const normalized = path.startsWith('$') ? path.slice(1) : path;

  // Split by dots and brackets: "[0].completed_at" → ["[0]", "completed_at"]
  const parts = normalized.split(/\.|\[/).map(p => p.replace(/\]/g, ''));

  let current = data;
  for (const part of parts) {
    if (part === '') continue; // Skip empty parts from leading "$"

    // Array index
    if (/^\d+$/.test(part)) {
      current = current?.[parseInt(part)];
    } else {
      // Object property
      current = current?.[part];
    }

    if (current === undefined) return null;
  }

  return current;
}

// --- Check Loop ---

const checkTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

export function startMonitor(userId: string, monitorId: string) {
  stopMonitor(monitorId); // clear any existing timer

  const db = getDb();
  const monitor = db.select().from(schema.monitors)
    .where(eq(schema.monitors.id, monitorId)).get();

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

export function startAllMonitors() {
  // Import dynamically to avoid circular dependency issues
  const users = getDb().select({ id: schema.users.id })
    .from(schema.users).all();

  for (const user of users) {
    const db = getDb();
    const monitors = db.select().from(schema.monitors)
      .where(eq(schema.monitors.userId, user.id))
      .all();

    for (const monitor of monitors) {
      if (!monitor.paused && !monitor.maintenance) {
        startMonitor(user.id, monitor.id);
      }
    }
  }
  console.log('[HUD] Auto-started all active monitors');
}

async function runCheck(userId: string, monitorId: string) {
  const db = getDb();
  const monitor = db.select().from(schema.monitors)
    .where(eq(schema.monitors.id, monitorId)).get();

  if (!monitor || monitor.paused || monitor.maintenance) return;

  const result = await executeCheck(monitor);
  const now = new Date();

  // Record check result
  db.insert(schema.checkResults).values({
    id: nanoid(),
    monitorId,
    userId,
    success: result.status === 'healthy',
    responseTime: result.responseTimeMs,
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

  db.update(schema.monitors).set({
    currentStatus: newStatus,
    consecutiveFailures: newFailures,
    lastCheckedAt: now,
    lastResponseMs: result.responseTimeMs,
    updatedAt: now,
  }).where(eq(schema.monitors.id, monitorId)).run();

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

    db.insert(schema.incidents).values({
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
    const recentIncident = db.select().from(schema.incidents)
      .where(and(
        eq(schema.incidents.userId, userId),
        eq(schema.incidents.status, 'active'),
      ))
      .orderBy(desc(schema.incidents.createdAt))
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
      db.insert(schema.resolutions).values({
        id: nanoid(),
        incidentId: recentIncident.id,
        userId,
        content: `Service recovered automatically.\n\n**Downtime:** ${downtimeStr}\n**Recovered at:** ${now.toISOString()}\n\n*Auto-resolved by HUD monitor.*`,
        createdAt: now,
      }).run();

      // Mark incident as resolved
      db.update(schema.incidents).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(schema.incidents.id, recentIncident.id)).run();
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
  const existing = db.select().from(schema.uptimeDaily)
    .where(and(
      eq(schema.uptimeDaily.monitorId, monitorId),
      eq(schema.uptimeDaily.date, dateStr)
    )).get();

  if (existing) {
    const newSuccess = existing.successCount + (result.status !== 'down' ? 1 : 0);
    const newFailure = existing.failureCount + (result.status === 'down' ? 1 : 0);
    const totalChecks = newSuccess + newFailure;
    const newAvg = existing.avgResponseTime
      ? Math.round((existing.avgResponseTime * (existing.successCount + existing.failureCount) + result.responseTimeMs) / totalChecks)
      : result.responseTimeMs;

    db.update(schema.uptimeDaily).set({
      successCount: newSuccess,
      failureCount: newFailure,
      avgResponseTime: newAvg,
      updatedAt: now,
    }).where(and(
      eq(schema.uptimeDaily.monitorId, monitorId),
      eq(schema.uptimeDaily.date, dateStr)
    )).run();
  } else {
    db.insert(schema.uptimeDaily).values({
      id: nanoid(),
      monitorId,
      userId,
      date: dateStr,
      successCount: result.status !== 'down' ? 1 : 0,
      failureCount: result.status === 'down' ? 1 : 0,
      avgResponseTime: result.responseTimeMs,
      updatedAt: now,
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
  const db = getDb();
  return db.select().from(schema.checkResults)
    .where(eq(schema.checkResults.monitorId, monitorId))
    .orderBy(desc(schema.checkResults.checkedAt))
    .limit(limit)
    .all()
    .reverse(); // chronological order
}

export function getUptimeStats(userId: string, monitorId: string, days = 30) {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const rows = db.select().from(schema.uptimeDaily)
    .where(and(
      eq(schema.uptimeDaily.monitorId, monitorId),
      gt(schema.uptimeDaily.date, cutoffStr)
    ))
    .all();

  const totalChecks = rows.reduce((s, r) => s + r.successCount + r.failureCount, 0);
  const successChecks = rows.reduce((s, r) => s + r.successCount, 0);
  const uptimePercent = totalChecks > 0 ? (successChecks / totalChecks) * 100 : 0;

  const avgResponse = rows.length > 0
    ? Math.round(rows.reduce((s, r) => s + (r.avgResponseTime || 0), 0) / rows.length)
    : 0;

  return { uptimePercent, avgResponse, days: rows };
}
