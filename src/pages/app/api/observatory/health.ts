/**
 * Observatory Health Check API
 *
 * Returns Observatory Watcher status, pending incidents, and diagnosis metrics.
 * Used by observatory-health-monitor to verify the system is processing incidents.
 *
 * GET /app/api/observatory/health
 *
 * Created: 2026-07-17
 * Part of: Observatory Verification Automation
 */

import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq, and, like, sql } from 'drizzle-orm';

export const GET: APIRoute = async () => {
  const db = getDb();

  // Query system_state directly via raw SQL (system_state table not in exported schema)
  const watcherStateRow = await db.get(sql`
    SELECT value FROM system_state WHERE key = 'observatory_last_run'
  `) as { value: string } | undefined;

  const modeStateRow = await db.get(sql`
    SELECT value FROM system_state WHERE key = 'observatory_mode'
  `) as { value: string } | undefined;

  // Get pending health-monitor incidents (active + tagged)
  const pendingIncidents = db.select({
    id: schema.incidents.id,
    title: schema.incidents.title,
    createdAt: schema.incidents.createdAt,
    updatedAt: schema.incidents.updatedAt,
  })
    .from(schema.incidents)
    .where(and(
      sql`${schema.incidents.tags} LIKE '%health-monitor%'`,
      eq(schema.incidents.status, 'active')
    ))
    .all();

  // Count incidents with diagnosis
  const diagnosedCount = db.select({ count: sql<number>`count(*)` })
    .from(schema.incidents)
    .where(and(
      sql`${schema.incidents.tags} LIKE '%health-monitor%'`,
      eq(schema.incidents.status, 'active'),
      sql`${schema.incidents.description} LIKE '%## Diagnosis%'`
    ))
    .get();

  // Calculate watcher age
  const now = Date.now();
  const lastRunMs = watcherStateRow?.value ? new Date(watcherStateRow.value).getTime() : 0;
  const watcherAgeSeconds = Math.floor((now - lastRunMs) / 1000);

  return new Response(JSON.stringify({
    watcher: {
      last_run: watcherStateRow?.value || null,
      age_seconds: watcherAgeSeconds,
      running: watcherAgeSeconds < 600, // Consider stuck if >10 min
    },
    mode: modeStateRow?.value || 'discover',
    incidents: {
      pending: pendingIncidents.length,
      diagnosed: diagnosedCount?.count || 0,
      pending_ids: pendingIncidents.map(i => i.id),
      pending_details: pendingIncidents.map(i => ({
        id: i.id,
        title: i.title,
        age_seconds: Math.floor((now - new Date(i.createdAt).getTime()) / 1000),
      })),
    },
    health: {
      ok: watcherAgeSeconds < 600 && pendingIncidents.length < 10,
      issues: [
        ...(watcherAgeSeconds >= 600 ? ['Watcher stuck (no run in 10+ minutes)'] : []),
        ...(pendingIncidents.length >= 10 ? ['Too many pending incidents'] : []),
      ],
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
