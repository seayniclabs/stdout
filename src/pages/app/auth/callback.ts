import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { exchangeCode, getUserInfo, findOrCreateUser, validateState } from '../../../lib/oidc';
import { getCentralDb, centralSchema, getTenantDb } from '../../../lib/db';
import { logAudit, getClientIp } from '../../../lib/audit';
import { sendWelcomeEmail } from '../../../lib/email';

// GET /app/auth/callback — handle OIDC callback from Authentik
export const GET: APIRoute = async ({ url, redirect, cookies, request }) => {
  // Use Astro's redirect helper so cookie mutations are reliably attached.
  const safeRedirect = (location: string) => redirect(location, 302);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const errorDescription = url.searchParams.get('error_description') || '';
    console.error('OIDC error:', error, errorDescription);
    const q = new URLSearchParams({ error });
    if (errorDescription) {
      q.set('error_description', errorDescription.slice(0, 500));
    }
    return safeRedirect(`/app/login?${q.toString()}`);
  }

  if (!code || !state) {
    return safeRedirect('/app/login?error=missing_params');
  }

  // Verify state
  const storedState = cookies.get('sl_oidc_state')?.value;
  if (!storedState || storedState !== state || !validateState(state)) {
    return safeRedirect('/app/login?error=invalid_state');
  }
  cookies.delete('sl_oidc_state', { path: '/' });

  // Read PKCE verifier — required, fail closed if missing
  const codeVerifier = cookies.get('sl_oidc_verifier')?.value;
  cookies.delete('sl_oidc_verifier', { path: '/' });

  if (!codeVerifier) {
    console.warn('OIDC callback missing PKCE verifier cookie');
    return safeRedirect('/app/login?error=missing_pkce_verifier');
  }

  // Exchange code for tokens with PKCE verifier
  const tokens = await exchangeCode(code, codeVerifier);
  if (!tokens) {
    return safeRedirect('/app/login?error=token_exchange_failed');
  }

  // Get user info
  let oidcUser;
  try {
    oidcUser = await getUserInfo(tokens.access_token);
  } catch (err) {
    console.error('OIDC getUserInfo threw:', err);
    return safeRedirect('/app/login?error=userinfo_failed');
  }
  if (!oidcUser || !oidcUser.email) {
    console.error('OIDC userinfo returned no email:', oidcUser);
    return safeRedirect('/app/login?error=userinfo_failed');
  }

  // Find or create local user (null if registration frozen for new users)
  const localUser = findOrCreateUser(oidcUser);
  if (!localUser) {
    return safeRedirect('/app/login?error=registration_closed');
  }

  // Ensure tenant DB exists
  getTenantDb(localUser.id);

  // Create session
  const sessionId = nanoid(32);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  getCentralDb().insert(centralSchema.sessions).values({
    id: sessionId,
    userId: localUser.id,
    expiresAt: expires,
  }).run();

  logAudit('login', {
    userId: localUser.id,
    ip: getClientIp(request),
    details: { method: 'oidc', email: oidcUser.email, sub: oidcUser.sub, isNew: localUser.isNew },
  });

  // Send welcome email for new OIDC users
  if (localUser.isNew) {
    sendWelcomeEmail(localUser.email, localUser.displayName || null).catch(() => {});
  }

  const maxAge = 30 * 24 * 60 * 60;
  cookies.set('sl_session', sessionId, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge,
  });

  // New users go to onboarding guides
  return safeRedirect(localUser.isNew ? '/app/docs?filter=stdout' : '/app');
};
