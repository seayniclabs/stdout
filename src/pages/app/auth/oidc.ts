import type { APIRoute } from 'astro';
import { getAuthorizationURL, generateState, generateCodeVerifier, generateCodeChallenge, isOIDCEnabled } from '../../../lib/oidc';

// GET /app/auth/oidc — redirect to Authentik login with PKCE
export const GET: APIRoute = async ({ cookies }) => {
  if (!isOIDCEnabled()) {
    return new Response(null, { status: 302, headers: { 'Location': '/app/login?error=oidc_not_configured' } });
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Clear any stale session cookie before starting OIDC flow
  const deleteSession = 'sl_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  const setState = `sl_oidc_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  const setVerifier = `sl_oidc_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

  const url = getAuthorizationURL(state, codeChallenge);
  return new Response(null, {
    status: 302,
    headers: new Headers([
      ['Location', url],
      ['Set-Cookie', deleteSession],
      ['Set-Cookie', setState],
      ['Set-Cookie', setVerifier],
    ]),
  });
};
