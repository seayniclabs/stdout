import type { APIRoute } from 'astro';
import { getAuthorizationURL, generateState, generateCodeVerifier, generateCodeChallenge, isOIDCEnabled } from '../../../lib/oidc';

// GET /app/auth/oidc — redirect to Authentik login with PKCE
export const GET: APIRoute = async ({ cookies, redirect }) => {
  if (!isOIDCEnabled()) {
    return redirect('/app/login?error=oidc_not_configured', 302);
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Use Astro cookie API so redirects reliably carry all cookie mutations.
  // Do not clear active session here; unexpected prefetch/retries can erase fresh auth.
  cookies.set('sl_oidc_state', state, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
  });
  cookies.set('sl_oidc_verifier', codeVerifier, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
  });

  const url = getAuthorizationURL(state, codeChallenge);
  return redirect(url, 302);
};
