import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const VALID_STEPS = [
  'license',
  'environment',
  'token',
  'scanner',
  'review',
  'windlass',
  'monitors',
  'done',
] as const;

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const db = getTenantDb(locals.workspace?.ownerId || locals.user.id);
  const prefs = db.select().from(tenantSchema.tenantPreferences)
    .where(eq(tenantSchema.tenantPreferences.userId, locals.workspace?.ownerId || locals.user.id))
    .get();

  const completed: string[] = prefs?.onboardingProgress
    ? JSON.parse(prefs.onboardingProgress)
    : [];
  const dismissed = prefs?.onboardingDismissed ?? false;

  return new Response(JSON.stringify({ completed, dismissed, steps: VALID_STEPS }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { action, step } = body as { action?: string; step?: string };

  const ownerId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(ownerId);

  let prefs = db.select().from(tenantSchema.tenantPreferences)
    .where(eq(tenantSchema.tenantPreferences.userId, ownerId))
    .get();

  if (!prefs) {
    db.insert(tenantSchema.tenantPreferences).values({
      id: nanoid(),
      userId: ownerId,
      onboardingProgress: '[]',
      onboardingDismissed: false,
      updatedAt: new Date(),
    }).run();
    prefs = db.select().from(tenantSchema.tenantPreferences)
      .where(eq(tenantSchema.tenantPreferences.userId, ownerId))
      .get()!;
  }

  const completed: string[] = prefs.onboardingProgress
    ? JSON.parse(prefs.onboardingProgress)
    : [];

  if (action === 'dismiss') {
    db.update(tenantSchema.tenantPreferences)
      .set({ onboardingDismissed: true, updatedAt: new Date() })
      .where(eq(tenantSchema.tenantPreferences.userId, ownerId))
      .run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'complete' && step && (VALID_STEPS as readonly string[]).includes(step) && !completed.includes(step)) {
    completed.push(step);
    db.update(tenantSchema.tenantPreferences)
      .set({
        onboardingProgress: JSON.stringify(completed),
        updatedAt: new Date(),
      })
      .where(eq(tenantSchema.tenantPreferences.userId, ownerId))
      .run();
  }

  return new Response(JSON.stringify({ completed, dismissed: prefs.onboardingDismissed }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
