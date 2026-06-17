/**
 * Comms Query Helpers
 *
 * Functions to query StdOut data for answering infrastructure questions
 * via the comms API (Sonique, Slack, SMS, etc.)
 */

import { getTenantDb } from '../db';
import { tenantSchema } from '../db';
import { eq, desc, and, sql, gte } from 'drizzle-orm';

export interface SystemHealthSummary {
  services_total: number;
  services_healthy: number;
  services_degraded: number;
  services_down: number;
  alerts_open: number;
  last_incident: string | null;
  uptime_pct: number;
}

export interface RecentIncident {
  id: string;
  title: string;
  severity: string;
  stack_name: string | null;
  created_at: number;
  resolved: boolean;
}

export interface SatelliteStatus {
  name: string;
  last_seen: number | null;
  alert_state: string;
  is_stale: boolean;
}

/**
 * Get overall system health summary
 */
export async function getSystemHealth(userId: string): Promise<SystemHealthSummary> {
  const db = getDb();

  // Get monitor counts by status - fetch all and count in JS
  const monitors = db
    .select()
    .from(schema.monitors)
    .where(
      and(
        eq(schema.monitors.userId, userId),
        eq(schema.monitors.paused, false),
        eq(schema.monitors.maintenance, false)
      )
    )
    .all();

  const services_total = monitors.length;
  const services_healthy = monitors.filter(m => m.currentStatus === 'healthy').length;
  const services_degraded = monitors.filter(m => m.currentStatus === 'degraded').length;
  const services_down = monitors.filter(m => m.currentStatus === 'down').length;

  // Get open incidents - count manually to avoid SQL issues
  const allIncidents = db
    .select()
    .from(schema.incidents)
    .where(eq(schema.incidents.userId, userId))
    .all();

  const alerts_open = allIncidents.filter(i => !i.resolvedAt).length;

  // Get last incident (createdAt is a Date — compare by epoch ms)
  const lastIncident = allIncidents.length > 0
    ? allIncidents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    : null;

  const last_incident = lastIncident
    ? new Date(lastIncident.createdAt).toISOString().split('T')[0]
    : null;

  // Calculate uptime percentage (last 24 hours).
  // Note: the uptime_daily table doesn't exist yet — return 100% until it's implemented.
  // (When it lands, compute Math.round(successful / total * 100) from the real rollup.)
  const uptime_pct = 100;

  return {
    services_total,
    services_healthy,
    services_degraded,
    services_down,
    alerts_open,
    last_incident,
    uptime_pct,
  };
}

/**
 * Get recent incidents (last 7 days)
 */
export async function getRecentIncidents(userId: string, limit = 5): Promise<RecentIncident[]> {
  const db = getDb();

  // Get all incidents and filter in JS to avoid timestamp conversion issues
  const allIncidents = db
    .select()
    .from(schema.incidents)
    .where(eq(schema.incidents.userId, userId))
    .orderBy(desc(schema.incidents.createdAt))
    .all();

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const incidents = allIncidents.filter(inc => inc.createdAt.getTime() >= sevenDaysAgo).slice(0, limit);

  // Get stack names
  const result: RecentIncident[] = [];
  for (const inc of incidents) {
    let stack_name: string | null = null;
    if (inc.stackId) {
      const stack = db
        .select()
        .from(schema.stacks)
        .where(eq(schema.stacks.id, inc.stackId))
        .get();
      stack_name = stack?.name || null;
    }

    result.push({
      id: inc.id,
      title: inc.title,
      severity: inc.severity,
      stack_name,
      created_at: inc.createdAt.getTime(),
      resolved: !!inc.resolvedAt,
    });
  }

  return result;
}

/**
 * Get satellite agent statuses
 * TODO: Implement satellite agents table
 */
export async function getSatelliteStatuses(userId: string): Promise<SatelliteStatus[]> {
  // Satellite agents not yet implemented - return empty array
  return [];
}

/**
 * Get stack summary (count and names)
 */
export async function getStacksSummary(userId: string): Promise<{
  total: number;
  names: string[];
}> {
  const db = getDb();

  const stacks = db
    .select()
    .from(schema.stacks)
    .where(eq(schema.stacks.userId, userId))
    .all();

  return {
    total: stacks.length,
    names: stacks.map((s) => s.name),
  };
}
