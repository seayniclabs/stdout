import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { exchangeCode, getUserInfo, findOrCreateUser, validateState } from '../../../lib/oidc';
import { getCentralDb, centralSchema, getTenantDb } from '../../../lib/db';
import { logAudit, getClientIp } from '../../../lib/audit';

// GET /app/auth/callback — handle OIDC callback from Authentik
export const GET: APIRoute = async ({ url, redirect, cookies, request }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    console.error('OIDC error:', error, url.searchParams.get('error_description'));
    return redirect(`/app/login?error=${error}`);
  }

  if (!code || !state) {
    return redirect('/app/login?error=missing_params');
  }

  // Verify state
  const storedState = cookies.get('sl_oidc_state')?.value;
  if (!storedState || storedState !== state || !validateState(state)) {
    return redirect('/app/login?error=invalid_state');
  }
  cookies.delete('sl_oidc_state', { path: '/' });

  // Exchange code for tokens
  const tokens = await exchangeCode(code);
  if (!tokens) {
    return redirect('/app/login?error=token_exchange_failed');
  }

  // Get user info
  console.log('OIDC callback: exchanged tokens, access_token present:', !!tokens.access_token, 'type:', tokens.token_type);
  let oidcUser;
  try {
    oidcUser = await getUserInfo(tokens.access_token);
  } catch (err) {
    console.error('OIDC getUserInfo threw:', err);
    return redirect('/app/login?error=userinfo_failed');
  }
  if (!oidcUser || !oidcUser.email) {
    console.error('OIDC userinfo returned no email:', oidcUser);
    return redirect('/app/login?error=userinfo_failed');
  }

  // Find or create local user
  const localUser = findOrCreateUser(oidcUser);

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

  // Set session cookie
  cookies.set('sl_session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  logAudit('login', {
    userId: localUser.id,
    ip: getClientIp(request),
    details: { method: 'oidc', email: oidcUser.email, sub: oidcUser.sub },
  });

  return redirect('/app');
};
