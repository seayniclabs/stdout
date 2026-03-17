import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { getCentralDb, centralSchema, evictTenantDb } from '../../../lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { deleteAllBackups } from '../../../lib/backup';
import { logAudit, getClientIp } from '../../../lib/audit';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : './data';

export const DELETE: APIRoute = async ({ locals, request, cookies }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const userId = locals.user.id;
  const email = locals.user.email;
  const ip = getClientIp(request);

  // Log the deletion before removing data
  logAudit('account_delete', {
    userId,
    ip,
    details: { email: email.replace(/(.{2}).*(@.*)/, '$1***$2') }, // Partially masked
  });

  // Record deletion for audit trail (uses email hash, not actual email)
  const emailHash = crypto.createHash('sha256').update(email).digest('hex');
  getCentralDb().insert(centralSchema.deletions).values({
    id: nanoid(),
    emailHash,
    deletedAt: new Date(),
  }).run();

  // Delete sessions
  getCentralDb().delete(centralSchema.sessions)
    .where(eq(centralSchema.sessions.userId, userId)).run();

  // Delete API tokens
  getCentralDb().delete(centralSchema.apiTokens)
    .where(eq(centralSchema.apiTokens.userId, userId)).run();

  // Delete user record
  getCentralDb().delete(centralSchema.users)
    .where(eq(centralSchema.users.id, userId)).run();

  // Evict tenant DB from pool
  evictTenantDb(userId);

  // Delete tenant DB file (SaaS mode)
  const selfHost = process.env.STDOUT_MODE !== 'saas';
  if (!selfHost) {
    const tenantPath = path.join(DATA_DIR, 'tenants', `${userId}.db`);
    const walPath = tenantPath + '-wal';
    const shmPath = tenantPath + '-shm';
    if (fs.existsSync(tenantPath)) fs.unlinkSync(tenantPath);
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  }

  // Delete all backups
  try {
    deleteAllBackups(userId);
  } catch { /* may not have backups */ }

  // Clear session cookie
  cookies.delete('sl_session', { path: '/' });

  return new Response(JSON.stringify({ deleted: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
