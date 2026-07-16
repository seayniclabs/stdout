/**
 * Windlass — Schedule-Aware Service Management
 *
 * Syncs service state from a Windlass engine (HTTP endpoint serving status.json)
 * into StdOut's tenant database. Provides helpers for service control,
 * schedule evaluation, and event logging.
 */

import { nanoid } from 'nanoid';
import { getDb, schema } from './db';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { fireAlert } from './alert-router';
import { sendWindlassWeeklyDigest } from './alert-router';
import { sumRecoveredGbHoursFromServices } from './windlass-weekly-digest-math';

// --- Types ---

export interface WindlassStatus {
  last_updated: string;
  summary: {
    running: number;
    stopped: number;
    total: number;
    docker_memory_used_mb: number;
    docker_memory_limit_mb: number;
    system_memory_total_mb: number;
    system_memory_free_mb: number;
    scheduler_interval_sec?: number;
  };
  services: WindlassServiceState[];
  upcoming_events: { time: string; service: string; action: string }[];
  recent_events: { timestamp: string; service: string; action: string; reason: string }[];
  schedule_windows: { service: string; windows: { start: string; end: string }[] }[];
  n8n_workflow_windows?: { name: string; cron: string; windows: { start: string; end: string }[] }[];
  service_analytics?: Record<string, {
    hourly?: Record<string, { running: number; idle: number; total: number }>;
    idle_minutes_total?: number;
    samples?: number;
  }>;
}

export interface N8nWorkflowWindow {
  name: string;
  cron: string;
  windows: { start: string; end: string }[];
}

export interface WindlassServiceState {
  name: string;
  type: 'always' | 'schedule' | 'on-demand' | 'manual';
  state: 'running' | 'stopped' | 'partial' | 'unknown';
  memory_mb: number;
  last_started: string | null;
  last_stopped: string | null;
  idle_since: string | null;
  next_start: string | null;
  next_stop: string | null;
  priority: number;
  description: string;
  containers: string[];
  last_memory_shed_reason?: string | null;
}

// Map Windlass engine types to StdOut classifications
const TYPE_MAP: Record<string, string> = {
  'always': 'always_on',
  'schedule': 'scheduled',
  'on-demand': 'on_demand',
  'manual': 'manual',
};

// --- Sync ---

/**
 * Fetch status.json from Windlass endpoint and sync into tenant DB.
 * Returns the number of services synced, or throws on failure.
 */
export async function syncFromEndpoint(userId: string): Promise<{ synced: number; summary: WindlassStatus['summary'] }> {
  const db = getDb();

  // Get config
  const config = db.select().from(schema.windlassConfig)
    .where(eq(schema.windlassConfig.userId, userId))
    .get();

  if (!config || !config.enabled) {
    throw new Error('Windlass not configured or disabled');
  }

  const url = config.endpointUrl.replace(/\/$/, '') + '/status.json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let status: WindlassStatus;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status = await res.json() as WindlassStatus;
  } finally {
    clearTimeout(timeout);
  }

  const now = new Date();

  // Upsert services
  for (const svc of status.services) {
    const id = svc.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const classification = (TYPE_MAP[svc.type] || 'manual') as 'always_on' | 'scheduled' | 'on_demand' | 'manual';
    const serviceType: 'always' | 'schedule' | 'on-demand' | 'manual' =
      (['always', 'schedule', 'on-demand', 'manual'].includes(svc.type) ? svc.type : 'manual') as any;

    // Determine expected state based on classification and schedule
    let expectedState: 'running' | 'stopped' = 'running';
    if (classification === 'manual') {
      expectedState = svc.state === 'running' ? 'running' : 'stopped';
    } else if (classification === 'on_demand') {
      expectedState = svc.state === 'running' ? 'running' : 'stopped';
    } else if (classification === 'scheduled') {
      // If there's a schedule window, check if we're in it
      const window = status.schedule_windows?.find(w => w.service === svc.name);
      if (window && window.windows.length > 0) {
        const inWindow = window.windows.some(w => {
          const start = new Date(w.start);
          const end = new Date(w.end);
          return now >= start && now <= end;
        });
        expectedState = inWindow ? 'running' : 'stopped';
      } else {
        expectedState = 'stopped';
      }
    }

    // Parse runtime windows from schedule
    let runtimeWindowStart: string | null = null;
    let runtimeWindowEnd: string | null = null;
    const schedWindow = status.schedule_windows?.find(w => w.service === svc.name);
    if (schedWindow && schedWindow.windows.length > 0) {
      const first = schedWindow.windows[0];
      runtimeWindowStart = new Date(first.start).toTimeString().slice(0, 5);
      runtimeWindowEnd = new Date(first.end).toTimeString().slice(0, 5);
    }

    const existing = db.select().from(schema.windlassServices)
      .where(and(eq(schema.windlassServices.id, id), eq(schema.windlassServices.userId, userId)))
      .get();

    const rawAnalytics = status.service_analytics?.[svc.name] || null;
    const samples = rawAnalytics?.samples || 0;
    const runningSamples = Object.values(rawAnalytics?.hourly || {})
      .reduce((sum, bucket: unknown) => sum + (bucket.running || 0), 0);
    const utilizationPct = samples > 0 ? Math.round((runningSamples / samples) * 100) : null;
    const idleMinutesTotal = rawAnalytics?.idle_minutes_total || 0;
    const intervalSec = status.summary.scheduler_interval_sec || 300;
    const observationDays = Math.max((samples * intervalSec) / 86400, 0.01);
    const idleHoursPerDay = idleMinutesTotal > 0 && samples > 0
      ? Math.min(24, Math.round((idleMinutesTotal / 60) / observationDays))
      : null;
    const schedulingSuggestion = idleHoursPerDay !== null && idleHoursPerDay >= 18
      ? `${svc.name} idle ~${idleHoursPerDay}h/day — suggest scheduling?`
      : null;
    const lastMemoryShedReason = (svc as WindlassServiceState).last_memory_shed_reason ?? null;

    if (existing) {
      // Detect state change → log event + fire alert
      if (existing.currentState !== svc.state) {
        const eventType = svc.state === 'running' ? 'service_started'
          : svc.state === 'stopped' ? 'service_stopped'
          : 'config_changed';
        logEvent(userId, id, eventType, `State changed: ${existing.currentState} → ${svc.state}`);

        // Fire alert for service down events
        // Alert if service was running and is now stopped or partial (degraded)
        // Manual services never alert
        const wasRunning = existing.currentState === 'running';
        const isDown = svc.state === 'stopped' || svc.state === 'partial';
        const shouldAlertDown = wasRunning && isDown && classification !== 'manual';
        if (shouldAlertDown) {
          fireAlert({
            userId,
            serviceId: id,
            eventType: 'service_down',
            severity: svc.priority <= 2 ? 'critical' : 'warning',
            title: `${svc.name} is down`,
            detail: `Service stopped unexpectedly. Classification: ${classification}, Priority: ${svc.priority}/5`,
          }).catch(err => console.error('Alert fire error:', err));
        }
        // Fire recovery alert
        if (svc.state === 'running' && existing.currentState === 'stopped') {
          fireAlert({
            userId,
            serviceId: id,
            eventType: 'service_up',
            severity: 'info',
            title: `${svc.name} recovered`,
            detail: `Service is running again`,
          }).catch(err => console.error('Alert fire error:', err));
        }
      }

      db.update(schema.windlassServices)
        .set({
          name: svc.name,
          serviceType,
          classification,
          memoryMb: svc.memory_mb,
          priority: svc.priority,
          description: svc.description,
          currentState: svc.state,
          expectedState,
          runtimeWindowStart,
          runtimeWindowEnd,
          lastStarted: svc.last_started ? new Date(svc.last_started) : null,
          lastStopped: svc.last_stopped ? new Date(svc.last_stopped) : null,
          lastStateChange: existing.currentState !== svc.state ? now : existing.lastStateChange,
          containers: JSON.stringify(svc.containers),
          containerCount: svc.containers?.length || 0,
          usageAnalytics: rawAnalytics ? JSON.stringify(rawAnalytics) : null,
          utilizationPct,
          idleHoursPerDay,
          schedulingSuggestion,
          lastMemoryShedReason,
          updatedAt: now,
        })
        .where(and(eq(schema.windlassServices.id, id), eq(schema.windlassServices.userId, userId)))
        .run();
    } else {
      db.insert(schema.windlassServices).values({
        id,
        userId,
        name: svc.name,
        serviceType,
        classification,
        memoryMb: svc.memory_mb,
        priority: svc.priority,
        description: svc.description,
        currentState: svc.state,
        expectedState,
        runtimeWindowStart,
        runtimeWindowEnd,
        lastStarted: svc.last_started ? new Date(svc.last_started) : null,
        lastStopped: svc.last_stopped ? new Date(svc.last_stopped) : null,
        lastStateChange: now,
        containers: JSON.stringify(svc.containers),
        containerCount: svc.containers?.length || 0,
        usageAnalytics: rawAnalytics ? JSON.stringify(rawAnalytics) : null,
        utilizationPct,
        idleHoursPerDay,
        schedulingSuggestion,
        lastMemoryShedReason,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  }

  // Ingest Windlass recent events (includes memory pressure auto-shedding).
  for (const evt of status.recent_events || []) {
    const eventAt = evt.timestamp ? new Date(evt.timestamp) : now;
    const serviceId = evt.service && evt.service !== 'system'
      ? evt.service.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      : null;
    const eventType = evt.action === 'memory_shed' ? 'memory_shed'
      : evt.action === 'manual_start' ? 'manual_start'
      : evt.action === 'manual_stop' ? 'manual_stop'
      : evt.action === 'sync_completed' ? 'sync_completed'
      : evt.action === 'service_started' ? 'service_started'
      : evt.action === 'service_stopped' ? 'service_stopped'
      : 'config_changed';

    const existingEvent = db.select().from(schema.windlassEvents)
      .where(and(
        eq(schema.windlassEvents.userId, userId),
        serviceId === null
          ? isNull(schema.windlassEvents.serviceId)
          : eq(schema.windlassEvents.serviceId, serviceId),
        eq(schema.windlassEvents.eventType, eventType as any),
        eq(schema.windlassEvents.createdAt, eventAt),
      ))
      .get();

    if (!existingEvent) {
      db.insert(schema.windlassEvents).values({
        id: nanoid(),
        userId,
        serviceId,
        eventType: eventType as any,
        detail: evt.reason || '',
        createdAt: eventAt,
      }).run();
    }

    if (eventType === 'memory_shed' && serviceId) {
      const reason = evt.reason || '';
      db.update(schema.windlassServices)
        .set({ lastMemoryShedReason: reason, updatedAt: now })
        .where(and(eq(schema.windlassServices.id, serviceId), eq(schema.windlassServices.userId, userId)))
        .run();
    }
  }

  // --- Reconciliation: mark missing services as decommissioned ---
  // Services that haven't been seen for 24+ hours are marked as stale
  const allServices = db.select().from(schema.windlassServices)
    .where(eq(schema.windlassServices.userId, userId))
    .all();

  const syncedServiceNames = new Set(status.services.map(s => s.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')));
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const svc of allServices) {
    if (!syncedServiceNames.has(svc.id)) {
      // Service is missing from latest sync
      if (!svc.decommissionedAt && svc.updatedAt < oneDayAgo) {
        // Mark as decommissioned if it's been missing for 24+ hours
        db.update(schema.windlassServices)
          .set({
            decommissionedAt: now,
            updatedAt: now,
          })
          .where(and(eq(schema.windlassServices.id, svc.id), eq(schema.windlassServices.userId, userId)))
          .run();

        logEvent(userId, svc.id, 'decommissioned', `Service auto-decommissioned: no longer appears in Windlass endpoint`);

        // Fire notification
        fireAlert({
          userId,
          serviceId: svc.id,
          eventType: 'service_decommissioned',
          severity: 'info',
          title: `${svc.name} has been decommissioned`,
          detail: `This service hasn't appeared in Windlass scans for 24+ hours and has been moved to archive.`,
        }).catch(err => console.error('Alert fire error:', err));
      }
    } else if (svc.decommissionedAt) {
      // Service is back — un-decommission it
      db.update(schema.windlassServices)
        .set({
          decommissionedAt: null,
          updatedAt: now,
        })
        .where(and(eq(schema.windlassServices.id, svc.id), eq(schema.windlassServices.userId, userId)))
        .run();

      logEvent(userId, svc.id, 'reactivated', `Service reactivated: appeared again in Windlass endpoint`);
    }
  }

  const n8nSnapshot = JSON.stringify(status.n8n_workflow_windows ?? []);

  // Update sync status + last n8n windows from engine (timeline reads this; avoids StdOut→localhost n8n hop)
  db.update(schema.windlassConfig)
    .set({
      lastSyncAt: now,
      lastSyncStatus: 'ok',
      n8nWorkflowWindowsJson: n8nSnapshot,
      updatedAt: now,
    })
    .where(eq(schema.windlassConfig.userId, userId))
    .run();

  await maybeSendWeeklyDigest(userId);

  // Log sync event
  logEvent(userId, null, 'sync_completed', `Synced ${status.services.length} services`);

  return { synced: status.services.length, summary: status.summary };
}

/** n8n execution windows last synced from the Windlass engine (preferred for timeline UI). */
export function getCachedN8nWorkflowWindows(userId: string): N8nWorkflowWindow[] {
  const cfg = getConfig(userId);
  const raw = cfg?.n8nWorkflowWindowsJson;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as N8nWorkflowWindow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Cached engine snapshot first; optional live n8n when `N8N_API_KEY` is set and cache is empty (dev / co-hosted). */
export async function getN8nWorkflowWindowsForDisplay(userId: string): Promise<N8nWorkflowWindow[]> {
  const cached = getCachedN8nWorkflowWindows(userId);
  if (cached.length) return cached;
  return getN8nWorkflowWindows(userId);
}

async function maybeSendWeeklyDigest(userId: string): Promise<void> {
  const db = getDb();
  const config = db.select().from(schema.windlassConfig)
    .where(eq(schema.windlassConfig.userId, userId))
    .get();
  if (!config) return;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const alreadySentThisWeek = config.lastWeeklyDigestAt
    && (now.getTime() - new Date(config.lastWeeklyDigestAt).getTime()) < (6 * 24 * 60 * 60 * 1000);
  if (alreadySentThisWeek || now.getUTCDay() !== 0) return;

  const services = db.select().from(schema.windlassServices)
    .where(eq(schema.windlassServices.userId, userId))
    .all();

  const recoveredGbHours = sumRecoveredGbHoursFromServices(services);

  if (recoveredGbHours <= 0) return;
  const sent = await sendWindlassWeeklyDigest(userId, {
    recoveredGbHours,
    serviceCount: services.length,
    weekLabel: sevenDaysAgo.toISOString().slice(0, 10) + ' to ' + now.toISOString().slice(0, 10),
  }, { skipCooldown: true });
  if (!sent.sent) return;

  db.update(schema.windlassConfig)
    .set({ lastWeeklyDigestAt: now, updatedAt: now })
    .where(eq(schema.windlassConfig.userId, userId))
    .run();
}

export async function getN8nWorkflowWindows(_userId: string): Promise<N8nWorkflowWindow[]> {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) return [];

  const base = (process.env.N8N_BASE_URL || 'http://localhost:5678/api/v1').replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/workflows`, {
      headers: { 'X-N8N-API-KEY': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const payload = await res.json() as { data?: unknown[] };
    const workflows = payload?.data || [];

    const now = new Date();
    return workflows
      .filter((wf: unknown) => wf?.active)
      .map((wf: unknown) => {
        const cronNode = (wf?.nodes || []).find((node: any) =>
          node?.type === 'n8n-nodes-base.cron' || node?.type?.includes('.cron'),
        );
        if (!cronNode) return null;

        const cronExpression = cronNode.parameters?.cronExpression
          || cronNode.parameters?.rule?.expression
          || cronNode.parameters?.triggerTimes?.item?.[0]?.cronExpression
          || '';
        if (!cronExpression) return null;

        const minuteHour = cronExpression.trim().split(/\s+/);
        if (minuteHour.length < 2) return null;
        const minute = Number(minuteHour[0]);
        const hour = Number(minuteHour[1]);
        if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
        if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

        const start = new Date(now);
        start.setHours(hour, minute, 0, 0);
        const end = new Date(start.getTime() + 15 * 60 * 1000);

        return {
          name: wf.name || wf.id || 'n8n workflow',
          cron: cronExpression,
          windows: [{ start: start.toISOString(), end: end.toISOString() }],
        } as N8nWorkflowWindow;
      })
      .filter(Boolean) as N8nWorkflowWindow[];
  } catch {
    return [];
  }
}

// --- Service Control ---

/**
 * Send a start/stop/restart command to the Windlass engine via commands.json.
 */
export async function controlService(
  userId: string,
  serviceId: string,
  action: 'start' | 'stop' | 'restart'
): Promise<void> {
  const db = getDb();
  const config = db.select().from(schema.windlassConfig)
    .where(eq(schema.windlassConfig.userId, userId))
    .get();

  if (!config) throw new Error('Windlass not configured');

  const service = db.select().from(schema.windlassServices)
    .where(and(eq(schema.windlassServices.id, serviceId), eq(schema.windlassServices.userId, userId)))
    .get();

  if (!service) throw new Error('Service not found');

  // POST command to Windlass endpoint
  const url = config.endpointUrl.replace(/\/$/, '') + '/commands.json';
  const commands = action === 'restart'
    ? [{ service: service.name, action: 'stop' }, { service: service.name, action: 'start' }]
    : [{ service: service.name, action }];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });

  if (!res.ok) throw new Error(`Command failed: HTTP ${res.status}`);

  const eventType = action === 'start' ? 'manual_start'
    : action === 'stop' ? 'manual_stop'
    : 'manual_start'; // restart logs as manual_start

  logEvent(userId, serviceId, eventType, `Manual ${action} requested`);
}

// --- Events ---

export function logEvent(
  userId: string,
  serviceId: string | null,
  eventType: string,
  detail: string
): void {
  const db = getDb();
  db.insert(schema.windlassEvents).values({
    id: nanoid(),
    userId,
    serviceId: serviceId ?? null,
    eventType: eventType as any,
    details: detail,
    createdAt: new Date(),
  }).run();
}

export function getRecentEvents(userId: string, limit = 50): unknown[] {
  const db = getDb();
  return db.select().from(schema.windlassEvents)
    .where(eq(schema.windlassEvents.userId, userId))
    .orderBy(desc(schema.windlassEvents.createdAt))
    .limit(limit)
    .all();
}

export function getServiceEvents(userId: string, serviceId: string, limit = 20): unknown[] {
  const db = getDb();
  return db.select().from(schema.windlassEvents)
    .where(and(
      eq(schema.windlassEvents.userId, userId),
      eq(schema.windlassEvents.serviceId, serviceId),
    ))
    .orderBy(desc(schema.windlassEvents.createdAt))
    .limit(limit)
    .all();
}

// --- Queries ---

export function getAllServices(userId: string) {
  const db = getDb();
  return db.select().from(schema.windlassServices)
    .where(eq(schema.windlassServices.userId, userId))
    .all();
}

export function getService(userId: string, serviceId: string) {
  const db = getDb();
  return db.select().from(schema.windlassServices)
    .where(and(
      eq(schema.windlassServices.id, serviceId),
      eq(schema.windlassServices.userId, userId),
    ))
    .get();
}

export function getConfig(userId: string) {
  const db = getDb();
  return db.select().from(schema.windlassConfig)
    .where(eq(schema.windlassConfig.userId, userId))
    .get();
}

export function getServiceSummary(userId: string) {
  const services = getAllServices(userId);
  const running = services.filter(s => s.currentState === 'running').length;
  const stopped = services.filter(s => s.currentState === 'stopped').length;
  const scheduled = services.filter(s => s.classification === 'scheduled').length;
  const totalMemory = services
    .filter(s => s.currentState === 'running')
    .reduce((sum, s) => sum + (s.memoryMb || 0), 0);

  return { total: services.length, running, stopped, scheduled, totalMemory };
}

/**
 * Auto-detect Windlass on common endpoints and configure if found
 * Checks localhost:8116 (default) and host.docker.internal:8116 (from container)
 */
export async function autoDetectAndConfigure(userId: string): Promise<boolean> {
  const db = getDb();

  // Check if already configured
  const existing = db.select().from(schema.windlassConfig)
    .where(eq(schema.windlassConfig.userId, userId))
    .get();

  if (existing && existing.enabled) {
    console.log('[windlass] Already configured, skipping auto-detect');
    return true;
  }

  // Try common endpoints
  const endpoints = [
    'http://localhost:8116',
    'http://host.docker.internal:8116',
    'http://windlass:8116', // Docker compose service name
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${endpoint}/status.json`, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const status = await res.json() as WindlassStatus;

        // Verify it's actually Windlass (has expected structure)
        if (status.services && Array.isArray(status.services)) {
          console.log(`[windlass] Auto-detected at ${endpoint}`);

          // Create or update config
          const now = new Date();
          if (existing) {
            db.update(schema.windlassConfig).set({
              endpointUrl: endpoint,
              enabled: true,
              lastSyncAt: now,
              lastSyncStatus: 'success',
              updatedAt: now,
            }).where(eq(schema.windlassConfig.userId, userId)).run();
          } else {
            db.insert(schema.windlassConfig).values({
              id: nanoid(),
              userId,
              endpointUrl: endpoint,
              enabled: true,
              lastSyncAt: now,
              lastSyncStatus: 'success',
              createdAt: now,
              updatedAt: now,
            }).run();
          }

          // Run initial sync
          try {
            await syncFromEndpoint(userId);
            console.log('[windlass] Initial sync complete');
          } catch (err) {
            console.error('[windlass] Initial sync failed:', err);
          }

          return true;
        }
      }
    } catch (err) {
      // Continue trying other endpoints
      continue;
    }
  }

  console.log('[windlass] Auto-detect failed - no Windlass found on common endpoints');
  return false;
}

