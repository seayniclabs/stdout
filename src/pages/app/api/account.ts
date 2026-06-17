import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { getDb, schema } from '../../../lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { logAudit, getClientIp } from '../../../lib/audit';

export const DELETE: APIRoute = async ({ locals, request, cookies }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  // Require confirmation word in request body
  let body: any = {};
  try { body = await request.json(); } catch {}

  if (body.confirmation !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Type DELETE to confirm account deletion.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.user.id;
  const email = locals.user.email;
  const ip = getClientIp(request);

  // Log the deletion
  logAudit('account_delete', {
    userId,
    ip,
    details: { email: email.replace(/(.{2}).*(@.*)/, '$1***$2') },
  });

  // Record deletion for audit trail + soft-delete window
  // Data is kept for 14 days before permanent purge
  const emailHash = crypto.createHash('sha256').update(email).digest('hex');
  getDb().insert(schema.deletions).values({
    id: nanoid(),
    emailHash,
    deletedAt: new Date(),
  }).run();

  // Soft-delete: mark user as deleted but keep data for 14 days
  // Set email to deleted_<hash>@deleted to free up the email address
  // but keep the record so we can restore if needed
  getDb().update(schema.users).set({
    email: `deleted_${emailHash.substring(0, 12)}@deleted`,
    role: 'member' as const,
    updatedAt: new Date(),
  }).where(eq(schema.users.id, userId)).run();

  // Delete sessions (force logout)
  getDb().delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId)).run();

  // Delete API tokens (revoke access)
  getDb().delete(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId)).run();

  // Evict tenant DB from pool (but DON'T delete the DB file or backups)
  // Data stays for 14 days — permanent purge handled by cleanup job
  evictTenantDb(userId);

  // Clear session cookie
  cookies.delete('sl_session', { path: '/' });

  return new Response(JSON.stringify({
    deleted: true,
    retentionDays: 14,
    message: 'Account deactivated. Data will be permanently purged in 14 days. Contact support for recovery.',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
