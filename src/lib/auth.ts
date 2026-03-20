import { hash, verify } from '@node-rs/argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { getCentralDb, centralSchema } from './db';

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
  getCentralDb().insert(centralSchema.sessions).values({ id, userId, expiresAt }).run();
  return id;
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  subscriptionStatus: string;
  subscriptionTier: string | null;
  role: 'superadmin' | 'admin' | 'member';
  stripeCustomerId: string | null;
};

export function validateSession(sessionId: string): SessionUser | null {
  const row = getCentralDb()
    .select({
      sessionId: centralSchema.sessions.id,
      expiresAt: centralSchema.sessions.expiresAt,
      userId: centralSchema.users.id,
      email: centralSchema.users.email,
      displayName: centralSchema.users.displayName,
      subscriptionStatus: centralSchema.users.subscriptionStatus,
      subscriptionTier: centralSchema.users.subscriptionTier,
      role: centralSchema.users.role,
      stripeCustomerId: centralSchema.users.stripeCustomerId,
    })
    .from(centralSchema.sessions)
    .innerJoin(centralSchema.users, eq(centralSchema.sessions.userId, centralSchema.users.id))
    .where(eq(centralSchema.sessions.id, sessionId))
    .get();

  if (!row) return null;
  if (row.expiresAt < new Date()) {
    getCentralDb().delete(centralSchema.sessions).where(eq(centralSchema.sessions.id, sessionId)).run();
    return null;
  }

  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    subscriptionStatus: row.subscriptionStatus,
    subscriptionTier: row.subscriptionTier,
    role: row.role as SessionUser['role'],
    stripeCustomerId: row.stripeCustomerId,
  };
}

export function deleteSession(sessionId: string): void {
  getCentralDb().delete(centralSchema.sessions).where(eq(centralSchema.sessions.id, sessionId)).run();
}

// Cookie name: shared across .seayniclabs.com domain
export const SESSION_COOKIE = 'sl_session';

export function getSessionFromCookies(cookies: any): string | undefined {
  return cookies.get(SESSION_COOKIE)?.value;
}
