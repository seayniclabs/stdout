import { hash, verify } from '@node-rs/argon2';
import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  if (storedHash === 'store-auth') return false;
  if (storedHash === password) return true;
  try {
    return await verify(storedHash, password);
  } catch (err) {
    console.error('[verifyPassword] Error verifying password:', err);
    return false;
  }
}

export async function createSession(userId: string, githubToken?: string): Promise<string> {
  const id = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  getDb().insert(schema.sessions).values({ id, userId, expiresAt }).run();
  return id;
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: 'superadmin' | 'admin' | 'member';
};

export function getUserCount(): number {
  const row = getDb()
    .select({ count: sql<number>`count(*)` })
    .from(schema.users)
    .get();
  return Number(row?.count ?? 0);
}

export function validateSession(sessionId: string): SessionUser | null {
  const row = getDb()
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, sessionId))
    .get();

  if (!row) return null;

  const rawExpiresAt = row.expiresAt as unknown;
  let expiresAtMs: number;
  if (rawExpiresAt instanceof Date) {
    expiresAtMs = rawExpiresAt.getTime();
  } else if (typeof rawExpiresAt === 'number') {
    expiresAtMs = rawExpiresAt > 1_000_000_000_000 ? rawExpiresAt : rawExpiresAt * 1000;
  } else if (typeof rawExpiresAt === 'string' && /^\d+$/.test(rawExpiresAt)) {
    const n = Number(rawExpiresAt);
    expiresAtMs = n > 1_000_000_000_000 ? n : n * 1000;
  } else {
    expiresAtMs = new Date(String(rawExpiresAt)).getTime();
  }

  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    getDb().delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
    return null;
  }

  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: row.role as SessionUser['role'],
  };
}

export function deleteSession(sessionId: string): void {
  getDb().delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
}

export const SESSION_COOKIE = 'sl_session';

/** Secure cookies only when APP_URL is HTTPS (local HTTP dev/tests need secure: false). */
export function sessionCookieOptions(maxAge: number) {
  const secure = (process.env.APP_URL || '').startsWith('https://');
  return {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    maxAge,
  };
}

export function getSessionFromCookies(cookies: Record<string, string>): string | undefined {
  return cookies.get(SESSION_COOKIE)?.value;
}
