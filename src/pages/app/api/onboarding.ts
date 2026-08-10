import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { requireAuth } from '../../../lib/rbac';

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
  const authError = requireAuth(locals);
  if (authError) return authError;

  const db = getDb();
  const prefs = db.select().from(schema.systemSettings).get();

  const completed: string[] = prefs?.onboardingProgress
    ? JSON.parse(prefs.onboardingProgress)
    : [];
  const dismissed = prefs?.onboardingDismissed ?? false;

  return new Response(JSON.stringify({ completed, dismissed, steps: VALID_STEPS }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'manage_settings');
  if (rbacBlock) return rbacBlock;

  const body = await request.json().catch(() => ({}));
  const { action, step } = body as { action?: string; step?: string };

  // CSRF check
  const { validateCsrf } = await import('../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || (body as any)._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getDb();

  let prefs = db.select().from(schema.systemSettings).get();

  if (!prefs) {
    db.insert(schema.systemSettings).values({
      id: 'instance',
      onboardingProgress: '[]',
      onboardingDismissed: false,
      updatedAt: new Date(),
    }).run();
    prefs = db.select().from(schema.systemSettings).get()!;
  }

  const completed: string[] = prefs.onboardingProgress
    ? JSON.parse(prefs.onboardingProgress)
    : [];

  if (action === 'dismiss') {
    db.update(schema.systemSettings)
      .set({ onboardingDismissed: true, updatedAt: new Date() })
      .run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'complete' && step && (VALID_STEPS as readonly string[]).includes(step) && !completed.includes(step)) {
    completed.push(step);
    db.update(schema.systemSettings)
      .set({
        onboardingProgress: JSON.stringify(completed),
        updatedAt: new Date(),
      })
      .run();
  }

  return new Response(JSON.stringify({ completed, dismissed: prefs.onboardingDismissed }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
