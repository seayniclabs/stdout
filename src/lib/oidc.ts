import crypto from 'node:crypto';
import fs from 'node:fs';
import { getCentralDb, centralSchema } from './db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// --- OIDC Configuration ---
// These come from env vars, set in docker-compose.yml

function getConfig() {
  return {
    clientId: readSecret('OIDC_CLIENT_ID'),
    clientSecret: readSecret('OIDC_CLIENT_SECRET'),
    issuer: process.env.OIDC_ISSUER || 'https://auth.seayniclabs.com/application/o/stdout',
    authorizeUrl: process.env.OIDC_AUTHORIZE_URL || 'https://auth.seayniclabs.com/application/o/authorize/',
    tokenUrl: process.env.OIDC_TOKEN_URL || 'https://auth.seayniclabs.com/application/o/token/',
    userinfoUrl: process.env.OIDC_USERINFO_URL || 'https://auth.seayniclabs.com/application/o/userinfo/',
    endSessionUrl: process.env.OIDC_END_SESSION_URL || 'https://auth.seayniclabs.com/application/o/stdout/end-session/',
    redirectUri: process.env.OIDC_REDIRECT_URI || '',
    enabled: !!(process.env.OIDC_CLIENT_ID || readSecret('OIDC_CLIENT_ID')),
  };
}

function readSecret(envName: string): string {
  // Try file-based secret first, then env var
  const filePath = process.env[`${envName}_FILE`] || `/run/secrets/${envName.toLowerCase()}`;
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return process.env[envName] || '';
  }
}

export function isOIDCEnabled(): boolean {
  return getConfig().enabled;
}

// --- Authorization URL ---

export function getAuthorizationURL(state: string): string {
  const config = getConfig();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    state,
  });
  return `${config.authorizeUrl}?${params}`;
}

// --- Token Exchange ---

interface TokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCode(code: string): Promise<TokenResponse | null> {
  const config = getConfig();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const resp = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    console.error('OIDC token exchange failed:', resp.status, await resp.text());
    return null;
  }

  const tokenData = await resp.json();
  console.log('OIDC token exchange success, scopes:', tokenData.scope);
  return tokenData;
}

// --- Userinfo ---

interface OIDCUser {
  sub: string;       // Authentik user UUID
  email: string;
  name?: string;
  preferred_username?: string;
}

export async function getUserInfo(accessToken: string): Promise<OIDCUser | null> {
  const config = getConfig();

  const resp = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error('OIDC userinfo failed:', resp.status, body);
    return null;
  }

  return resp.json();
}

// --- Find or Create Local User ---

export function findOrCreateUser(oidcUser: OIDCUser): { id: string; email: string; displayName: string } {
  const db = getCentralDb();

  // Look up by email first
  let user = db.select().from(centralSchema.users)
    .where(eq(centralSchema.users.email, oidcUser.email)).get();

  if (user) {
    return { id: user.id, email: user.email, displayName: user.displayName || oidcUser.name || '' };
  }

  // Create new user — no password since auth is via OIDC
  const id = nanoid();
  const now = new Date();
  const displayName = oidcUser.name || oidcUser.preferred_username || oidcUser.email.split('@')[0];

  db.insert(centralSchema.users).values({
    id,
    email: oidcUser.email,
    passwordHash: '', // OIDC user — no local password
    displayName,
    subscriptionStatus: 'free',
    role: 'member',
    emailVerified: true, // Authentik already verified
    createdAt: now,
    updatedAt: now,
  }).run();

  return { id, email: oidcUser.email, displayName };
}

// --- State Management (CSRF for OAuth flow) ---

const stateStore = new Map<string, { createdAt: number }>();

export function generateState(): string {
  const state = crypto.randomBytes(32).toString('hex');
  stateStore.set(state, { createdAt: Date.now() });
  // Clean old states (>10 min)
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of stateStore) {
    if (val.createdAt < cutoff) stateStore.delete(key);
  }
  return state;
}

export function validateState(state: string): boolean {
  if (!stateStore.has(state)) return false;
  stateStore.delete(state);
  return true;
}

// --- Logout URL ---

export function getLogoutURL(): string {
  return getConfig().endSessionUrl;
}
