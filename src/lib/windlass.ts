/**
 * Windlass — Schedule-Aware Service Management
 *
 * Syncs service state from a Windlass engine (HTTP endpoint serving status.json)
 * into StdOut's tenant database. Provides helpers for service control,
 * schedule evaluation, and event logging.
 */

import { nanoid } from 'nanoid';
import { getTenantDb, tenantSchema } from './db';
import { eq, and, desc } from 'drizzle-orm';

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
  };
  services: WindlassServiceState[];
  upcoming_events: { time: string; service: string; action: string }[];
  recent_events: { timestamp: string; service: string; action: string; reason: string }[];
  schedule_windows: { service: string; windows: { start: string; end: string }[] }[];
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
  const db = getTenantDb(userId);

  // Get config
  const config = db.select().from(tenantSchema.windlassConfig)
    .where(eq(tenantSchema.windlassConfig.userId, userId))
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
    const classification = TYPE_MAP[svc.type] || 'manual';

    // Determine expected state based on classification and schedule
    let expectedState = 'running';
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

    const existing = db.select().from(tenantSchema.windlassServices)
      .where(and(eq(tenantSchema.windlassServices.id, id), eq(tenantSchema.windlassServices.userId, userId)))
      .get();

    if (existing) {
      // Detect state change → log event
      if (existing.currentState !== svc.state) {
        const eventType = svc.state === 'running' ? 'service_started'
          : svc.state === 'stopped' ? 'service_stopped'
          : 'config_changed';
        logEvent(userId, id, eventType, `State changed: ${existing.currentState} → ${svc.state}`);
      }

      db.update(tenantSchema.windlassServices)
        .set({
          name: svc.name,
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
          updatedAt: now,
        })
        .where(and(eq(tenantSchema.windlassServices.id, id), eq(tenantSchema.windlassServices.userId, userId)))
        .run();
    } else {
      db.insert(tenantSchema.windlassServices).values({
        id,
        userId,
        name: svc.name,
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
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  }

  // Update sync status
  db.update(tenantSchema.windlassConfig)
    .set({ lastSyncAt: now, lastSyncStatus: 'ok', updatedAt: now })
    .where(eq(tenantSchema.windlassConfig.userId, userId))
    .run();

  // Log sync event
  logEvent(userId, null, 'sync_completed', `Synced ${status.services.length} services`);

  return { synced: status.services.length, summary: status.summary };
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
  const db = getTenantDb(userId);
  const config = db.select().from(tenantSchema.windlassConfig)
    .where(eq(tenantSchema.windlassConfig.userId, userId))
    .get();

  if (!config) throw new Error('Windlass not configured');

  const service = db.select().from(tenantSchema.windlassServices)
    .where(and(eq(tenantSchema.windlassServices.id, serviceId), eq(tenantSchema.windlassServices.userId, userId)))
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
  const db = getTenantDb(userId);
  db.insert(tenantSchema.windlassEvents).values({
    id: nanoid(),
    userId,
    serviceId,
    eventType: eventType as any,
    detail,
    createdAt: new Date(),
  }).run();
}

export function getRecentEvents(userId: string, limit = 50): any[] {
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.windlassEvents)
    .where(eq(tenantSchema.windlassEvents.userId, userId))
    .orderBy(desc(tenantSchema.windlassEvents.createdAt))
    .limit(limit)
    .all();
}

export function getServiceEvents(userId: string, serviceId: string, limit = 20): any[] {
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.windlassEvents)
    .where(and(
      eq(tenantSchema.windlassEvents.userId, userId),
      eq(tenantSchema.windlassEvents.serviceId, serviceId),
    ))
    .orderBy(desc(tenantSchema.windlassEvents.createdAt))
    .limit(limit)
    .all();
}

// --- Queries ---

export function getAllServices(userId: string) {
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.windlassServices)
    .where(eq(tenantSchema.windlassServices.userId, userId))
    .all();
}

export function getService(userId: string, serviceId: string) {
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.windlassServices)
    .where(and(
      eq(tenantSchema.windlassServices.id, serviceId),
      eq(tenantSchema.windlassServices.userId, userId),
    ))
    .get();
}

export function getConfig(userId: string) {
  const db = getTenantDb(userId);
  return db.select().from(tenantSchema.windlassConfig)
    .where(eq(tenantSchema.windlassConfig.userId, userId))
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
