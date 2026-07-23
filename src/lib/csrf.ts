import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Get or create CSRF token for the session
 * Stores in httpOnly cookie for security
 */
export function getCsrfToken(cookies: AstroCookies): string {
  let token = cookies.get(CSRF_COOKIE)?.value;

  if (!token) {
    token = generateCsrfToken();
    cookies.set(CSRF_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });
  }

  return token;
}

/**
 * Validate CSRF token from request against cookie
 * Call this in API endpoints that mutate state (POST/PUT/PATCH/DELETE)
 *
 * @param request - Astro request object
 * @param cookies - Astro cookies object
 * @returns true if valid, false otherwise
 */
export function validateCsrfToken(request: Request, cookies: AstroCookies): boolean {
  const cookieToken = cookies.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get(CSRF_HEADER);

  if (!cookieToken || !headerToken) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(headerToken)
  );
}

/**
 * Rotate CSRF token after sensitive operations
 * Call after: password change, role change, account deletion
 */
export function rotateCsrfToken(cookies: AstroCookies): string {
  const newToken = generateCsrfToken();
  cookies.set(CSRF_COOKIE, newToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
  return newToken;
}

/**
 * Helper to return CSRF error response
 */
export function csrfError(): Response {
  return new Response(
    JSON.stringify({
      error: 'CSRF token validation failed',
      code: 'CSRF_INVALID'
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
