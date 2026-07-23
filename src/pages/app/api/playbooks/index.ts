/**
 * Playbooks API Endpoints
 * GET /api/playbooks - List playbooks
 * POST /api/playbooks - Create playbook
 */

import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { getBuiltInPlaybooks } from '../../../../lib/remediation/playbooks';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';
import { validateCsrf } from '../../../../middleware';

export const GET: APIRoute = async ({ locals }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  try {
    const db = getDb();
    const userId = locals.user!.id;

    // Fetch user playbooks + built-in playbooks
    const userPlaybooks = db.select()
      .from(schema.remediationPlaybooks)
      .where(eq(schema.remediationPlaybooks.userId, userId))
      .all();

    // Combine with built-in playbooks
    const builtIn = getBuiltInPlaybooks();
    const allPlaybooks = [
      ...userPlaybooks.map((p) => ({
        ...p,
        trigger: JSON.parse(p.trigger as string),
        steps: JSON.parse(p.steps as string),
        rollback: JSON.parse(p.rollback as string),
        tags: JSON.parse(p.tags as string),
      })),
      ...builtIn,
    ];

    return new Response(JSON.stringify({ playbooks: allPlaybooks }), { status: 200 });
  } catch (error) {
    console.error('Error fetching playbooks:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch playbooks' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - playbook management requires manage_settings permission
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  try {
    const userId = locals.user!.id;
    const body = await request.json() as any;

    // CSRF check
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
    }
    const { name, description, trigger, steps, rollback, requiresApproval, timeout, riskLevel, tags } = body;

    if (!name || !description || !trigger || !steps) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const db = getDb();
    const playbookId = nanoid();
    const now = new Date();

    db.insert(schema.remediationPlaybooks).values({
      id: playbookId,
      userId,
      name,
      description,
      trigger: JSON.stringify(trigger),
      steps: JSON.stringify(steps),
      rollback: JSON.stringify(rollback || []),
      requiresApproval: requiresApproval ? 1 : 0,
      timeout: timeout || 300,
      riskLevel: riskLevel || 'medium',
      tags: JSON.stringify(tags || []),
      isBuiltIn: false,
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    }).run();

    return new Response(JSON.stringify({ id: playbookId, message: 'Playbook created' }), { status: 201 });
  } catch (error) {
    console.error('Error creating playbook:', error);
    return new Response(JSON.stringify({ error: 'Failed to create playbook' }), { status: 500 });
  }
};
