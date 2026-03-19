import type { APIRoute } from 'astro';
import { getAuthorizationURL, generateState, isOIDCEnabled } from '../../../lib/oidc';

// GET /app/auth/oidc — redirect to Authentik login
export const GET: APIRoute = async ({ redirect, cookies }) => {
  if (!isOIDCEnabled()) {
    return redirect('/app/login?error=oidc_not_configured');
  }

  const state = generateState();

  // Store state in cookie for callback verification
  cookies.set('sl_oidc_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  const url = getAuthorizationURL(state);
  return redirect(url);
};
