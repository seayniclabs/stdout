/**
 * External Incidents API
 *
 * Allows external health monitors (like Bosun) to create incidents in StdOut.
 * This enables the Bridge/StdOut split: health monitors → StdOut incidents → Observatory handles them.
 *
 * POST /app/api/incidents/external
 * Body: { title, description, severity, source, metadata }
 * Auth: Bearer token (STDOUT_HEALTH_TOKEN env var)
 *
 * Created: 2026-07-17
 * Part of: Bridge/StdOut Architecture Split
 */

import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { nanoid } from 'nanoid';
import { notify } from '../../../../lib/notify';
import { emit } from '../../../../lib/events';
import { timingSafeEqual } from 'node:crypto';

const HEALTH_TOKEN = process.env.STDOUT_HEALTH_TOKEN || 'dev-health-token';

export const POST: APIRoute = async ({ request }) => {
  // Verify auth token (simple Bearer token, NOT stdout_scan_ format)
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  // Use constant-time comparison to prevent timing attacks
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(HEALTH_TOKEN);

  if (tokenBuffer.length !== expectedBuffer.length || !timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return new Response(JSON.stringify({
      error: 'Unauthorized',
      hint: 'Set STDOUT_HEALTH_TOKEN env var to match your health monitor configuration'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Parse request
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { title, description, severity = 'high', source = 'health-monitor', metadata = {} } = body;

  if (!title || !description) {
    return new Response(JSON.stringify({
      error: 'Missing required fields',
      required: ['title', 'description']
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get first user (self-hosted = single user)
  const db = getDb();
  const firstUser = db.select().from(schema.users).limit(1).get();

  if (!firstUser) {
    return new Response(JSON.stringify({
      error: 'No user found - setup wizard not complete'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Create incident
  const id = nanoid();
  const now = new Date();
  const tags = `health-monitor,${source},observatory`;

  db.insert(schema.incidents).values({
    id,
    userId: firstUser.id,
    stackId: null, // Health monitors are infrastructure-wide, not stack-specific
    title,
    description,
    severity: severity as 'critical' | 'high' | 'medium' | 'low',
    tags,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }).run();

  // Sync to FTS
  const rawDb = (db as any).$client;
  if (rawDb?.prepare) {
    try {
      rawDb.prepare(
        'INSERT INTO incidents_fts(rowid, title, description, tags) SELECT rowid, title, description, tags FROM incidents WHERE id = ?'
      ).run(id);
    } catch (err) {
      // FTS may not exist yet - non-critical
      console.warn('[external-incidents] FTS sync failed:', err);
    }
  }

  // Emit event for Observatory to pick up
  emit({
    type: 'incident.created',
    userId: firstUser.id,
    incidentId: id,
    severity,
    source: 'external-health-monitor',
  });

  // Notify
  await notify(firstUser.id, {
    event: severity === 'critical' ? 'severity_critical' : 'incident_created',
    title: `Health Monitor: ${title}`,
    body: description.substring(0, 200),
    url: `/app/incidents/${id}`,
    metadata: { severity, incidentId: id, source, ...metadata },
  });

  console.log(`[external-incidents] Created incident ${id} from ${source}: ${title}`);

  return new Response(JSON.stringify({
    success: true,
    incidentId: id,
    message: 'Incident created successfully',
    url: `/app/incidents/${id}`
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' }
  });
};
