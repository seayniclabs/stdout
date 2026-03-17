import { hash, verify } from '@node-rs/argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  return verify(storedHash, password);
}

export async function createSession(userId: string): Promise<string> {
  const id = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  getDb().insert(schema.sessions).values({ id, userId, expiresAt }).run();
  return id;
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  subscriptionStatus: string;
  role: 'superadmin' | 'admin' | 'member';
  stripeCustomerId: string | null;
};

export function validateSession(sessionId: string): SessionUser | null {
  const row = getDb()
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      subscriptionStatus: schema.users.subscriptionStatus,
      role: schema.users.role,
      stripeCustomerId: schema.users.stripeCustomerId,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, sessionId))
    .get();

  if (!row) return null;
  if (row.expiresAt < new Date()) {
    getDb().delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
    return null;
  }

  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    subscriptionStatus: row.subscriptionStatus,
    role: row.role as SessionUser['role'],
    stripeCustomerId: row.stripeCustomerId,
  };
}

export function deleteSession(sessionId: string): void {
  getDb().delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
}

// Cookie name: shared across .seayniclabs.com domain
export const SESSION_COOKIE = 'sl_session';

export function getSessionFromCookies(cookies: any): string | undefined {
  return cookies.get(SESSION_COOKIE)?.value;
}
