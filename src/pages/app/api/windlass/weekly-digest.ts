import type { APIRoute } from 'astro';
import { getCentralDb, getTenantDb, tenantSchema, centralSchema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { sendWindlassWeeklyDigest } from '../../../../lib/alert-router';
import { sumRecoveredGbHoursFromServices } from '../../../../lib/windlass-weekly-digest-math';

const SELF_HOST = process.env.STDOUT_MODE !== 'saas';

function computeRecoveredGbHours(userId: string): { recoveredGbHours: number; serviceCount: number } {
  const db = getTenantDb(userId);
  const services = db.select().from(tenantSchema.windlassServices)
    .where(eq(tenantSchema.windlassServices.userId, userId))
    .all();
  return { recoveredGbHours: sumRecoveredGbHoursFromServices(services), serviceCount: services.length };
}

/** Cron / curl must present the secret; browser sessions are already authenticated. */
function digestSecretMatches(request: Request, hasSession: boolean): boolean {
  const secret = process.env.WINDLASS_WEEKLY_DIGEST_SECRET;
  if (!secret || hasSession) return true;
  const hdr = request.headers.get('x-windlass-digest-secret');
  return hdr === secret;
}

async function runWeeklyDigestForUser(userId: string, force: boolean): Promise<Response> {
  const db = getTenantDb(userId);

  const { recoveredGbHours, serviceCount } = computeRecoveredGbHours(userId);

  if (recoveredGbHours <= 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'No usage analytics with idle time — sync Windlass first.',
    }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!force) {
    const cfg = db.select().from(tenantSchema.windlassConfig)
      .where(eq(tenantSchema.windlassConfig.userId, userId))
      .get();
    const last = cfg?.lastWeeklyDigestAt ? new Date(cfg.lastWeeklyDigestAt).getTime() : 0;
    if (last && Date.now() - last < 6 * 24 * 60 * 60 * 1000) {
      return new Response(JSON.stringify({
        ok: false,
        skipped: 'weekly_digest_cooldown',
        message: 'Digest sent within the last 6 days. Pass {"force":true} or ?force=1 to override.',
      }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const now = new Date();
  const weekLabel = now.toISOString().slice(0, 10);

  const result = await sendWindlassWeeklyDigest(userId, {
    recoveredGbHours,
    serviceCount,
    weekLabel,
  }, { skipCooldown: true });

  if (!result.sent) {
    return new Response(JSON.stringify({
      ok: false,
      skipped: result.skipped || 'not_sent',
    }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }

  db.update(tenantSchema.windlassConfig)
    .set({ lastWeeklyDigestAt: now, updatedAt: now })
    .where(eq(tenantSchema.windlassConfig.userId, userId))
    .run();

  return new Response(JSON.stringify({
    ok: true,
    summary: {
      recoveredGbHours,
      serviceCount,
      weekLabel,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /app/api/windlass/weekly-digest
 * Trigger the weekly savings digest (GB-hours from Windlass usage analytics).
 * When WINDLASS_WEEKLY_DIGEST_SECRET is set, require header X-Windlass-Digest-Secret for unauthenticated calls (curl/cron). Logged-in UI requests do not need the header.
 *
 * Self-host only, no session: same secret header + STDOUT_MODE !== saas runs digest for every user
 * that has Windlass enabled (typically one) — supports machine cron without a browser cookie.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!digestSecretMatches(request, !!locals.user)) {
    return new Response(JSON.stringify({ error: 'Invalid digest secret' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { force?: boolean } = {};
  try {
    if (request.headers.get('Content-Type')?.includes('application/json')) {
      body = await request.json();
    }
  } catch {
    body = {};
  }
  const force = body.force === true;

  if (locals.user) {
    const userId = locals.workspace?.ownerId || locals.user.id;
    return runWeeklyDigestForUser(userId, force);
  }

  if (!SELF_HOST) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!process.env.WINDLASS_WEEKLY_DIGEST_SECRET) {
    return new Response(JSON.stringify({
      error: 'Unauthenticated digest requires WINDLASS_WEEKLY_DIGEST_SECRET to be set.',
    }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  const users = getCentralDb().select({ id: centralSchema.users.id }).from(centralSchema.users).all();
  const results: { userId: string; status: number; body: unknown }[] = [];

  for (const { id } of users) {
    const cfg = getTenantDb(id).select().from(tenantSchema.windlassConfig)
      .where(eq(tenantSchema.windlassConfig.userId, id))
      .get();
    if (!cfg?.enabled) continue;

    const res = await runWeeklyDigestForUser(id, force);
    const status = res.status;
    let parsed: unknown;
    try { parsed = JSON.parse(await res.text()); } catch { parsed = {}; }
    results.push({ userId: id, status, body: parsed });
  }

  return new Response(JSON.stringify({ ok: true, cron: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * GET /app/api/windlass/weekly-digest?secret=…&force=1
 * Convenience for curl in crontab (self-host only). Same secret as WINDLASS_WEEKLY_DIGEST_SECRET.
 * Logged-in users may call GET without query secret (session auth).
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const secret = process.env.WINDLASS_WEEKLY_DIGEST_SECRET;
  const q = url.searchParams.get('secret');
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  if (locals.user) {
    const userId = locals.workspace?.ownerId || locals.user.id;
    return runWeeklyDigestForUser(userId, force);
  }

  if (!SELF_HOST) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!secret || q !== secret) {
    return new Response(JSON.stringify({ error: 'Invalid or missing secret' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const users = getCentralDb().select({ id: centralSchema.users.id }).from(centralSchema.users).all();
  const results: { userId: string; status: number; body: unknown }[] = [];

  for (const { id } of users) {
    const cfg = getTenantDb(id).select().from(tenantSchema.windlassConfig)
      .where(eq(tenantSchema.windlassConfig.userId, id))
      .get();
    if (!cfg?.enabled) continue;

    const res = await runWeeklyDigestForUser(id, force);
    const status = res.status;
    let parsed: unknown;
    try { parsed = JSON.parse(await res.text()); } catch { parsed = {}; }
    results.push({ userId: id, status, body: parsed });
  }

  return new Response(JSON.stringify({ ok: true, cron: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
