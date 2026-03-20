import type { APIRoute } from 'astro';
import { getCentralDb, centralSchema } from '../../../lib/db';
import { eq } from 'drizzle-orm';
import { logAudit, getClientIp } from '../../../lib/audit';
import fs from 'node:fs';

export const prerender = false;

function readSecret(): string {
  // Try file-based secret first (Docker), then env var
  const filePath = process.env.BILLING_SYNC_SECRET_FILE || '/run/secrets/billing_sync_secret';
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return process.env.BILLING_SYNC_SECRET || '';
  }
}

/**
 * POST /app/api/billing-sync
 *
 * Called by store.seayniclabs.com when a StdOut subscription changes.
 * Authenticated via shared secret (BILLING_SYNC_SECRET env var or file).
 *
 * Body: { email, status, tier, periodEnd }
 */
export const POST: APIRoute = async ({ request }) => {
  const syncSecret = readSecret();
  if (!syncSecret) {
    console.error('[billing-sync] BILLING_SYNC_SECRET not set');
    return new Response('Server configuration error', { status: 500 });
  }

  // Verify shared secret
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== syncSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: {
    email: string;
    status: string;    // active, past_due, expired
    tier: string | null; // solo, shop, self-host
    periodEnd: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.email || !body.status) {
    return new Response('Missing email or status', { status: 400 });
  }

  const db = getCentralDb();

  // Find user by email
  const user = db.select().from(centralSchema.users)
    .where(eq(centralSchema.users.email, body.email.toLowerCase()))
    .get();

  if (!user) {
    console.log(`[billing-sync] User not found: ${body.email}`);
    return new Response(JSON.stringify({ ok: false, reason: 'user_not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Map store status to StdOut status
  let subscriptionStatus: string;
  switch (body.status) {
    case 'active':
      subscriptionStatus = 'active';
      break;
    case 'past_due':
      subscriptionStatus = 'past_due';
      break;
    case 'expired':
    case 'cancelled':
      subscriptionStatus = 'expired';
      break;
    default:
      subscriptionStatus = 'none';
  }

  const periodEnd = body.periodEnd ? new Date(body.periodEnd) : null;

  // Update user record
  db.update(centralSchema.users)
    .set({
      subscriptionStatus,
      subscriptionTier: body.tier || null,
      subscriptionPeriodEnd: periodEnd,
      updatedAt: new Date(),
    })
    .where(eq(centralSchema.users.id, user.id))
    .run();

  logAudit('billing_sync', {
    userId: user.id,
    ip: getClientIp(request),
    details: {
      status: subscriptionStatus,
      tier: body.tier,
      periodEnd: body.periodEnd,
      previousStatus: user.subscriptionStatus,
    },
  });

  console.log(`[billing-sync] Updated ${body.email}: ${user.subscriptionStatus} → ${subscriptionStatus} (${body.tier})`);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
