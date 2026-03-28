import { defineMiddleware } from 'astro:middleware';
import { validateSession, getSessionFromCookies, SESSION_COOKIE } from './lib/auth';
import { getCentralDb, centralSchema } from './lib/db';
import { getWorkspaceContext } from './lib/rbac';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

// --- Bearer Token Auth (for scanner API) ---
const BEARER_PATHS = ['/app/api/stacks/import'];

function validateBearerToken(request: Request): { userId: string } | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const rawToken = authHeader.slice(7);
  if (!rawToken.startsWith('stdout_scan_')) return null;

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const row = getCentralDb()
    .select({
      id: centralSchema.apiTokens.id,
      userId: centralSchema.apiTokens.userId,
    })
    .from(centralSchema.apiTokens)
    .where(eq(centralSchema.apiTokens.tokenHash, tokenHash))
    .get();

  if (!row) return null;

  // Update last_used_at
  getCentralDb().update(centralSchema.apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(centralSchema.apiTokens.id, row.id))
    .run();

  return { userId: row.userId };
}

// --- CSRF Origin Check ---
const ALLOWED_ORIGINS: string[] = [];

// SaaS mode: allow the production domains
if (!process.env.STDOUT_MODE || process.env.STDOUT_MODE === 'saas') {
  ALLOWED_ORIGINS.push(
    'https://stdout.seayniclabs.com',
    'https://seayniclabs.com',
  );
}

// Self-hosted mode: allow the configured APP_URL
if (process.env.APP_URL) {
  ALLOWED_ORIGINS.push(process.env.APP_URL.replace(/\/$/, ''));
}

// Always allow localhost for dev
ALLOWED_ORIGINS.push('http://localhost:4321', 'http://localhost:3000');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function checkOrigin(request: Request): boolean {
  if (!MUTATING_METHODS.has(request.method)) return true;
  const origin = request.headers.get('origin');
  if (!origin) return false; // Reject mutating requests with no Origin header
  return ALLOWED_ORIGINS.some(allowed => origin === allowed);
}

// --- Rate Limiting ---
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMITED_PATHS = ['/app/login', '/app/register', '/app/forgot-password', '/app/reset-password'];

function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function checkRateLimit(request: Request, pathname: string): Response | null {
  if (process.env.STDOUT_DISABLE_RATE_LIMIT === '1') return null;
  if (request.method !== 'POST') return null;
  if (!RATE_LIMITED_PATHS.some(p => pathname === p || pathname === p + '/')) return null;

  const ip = getClientIp(request);
  const key = `${ip}:${pathname}`;
  const now = Date.now();

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return new Response('Too many attempts. Please try again later.', {
      status: 429,
      headers: { 'Retry-After': String(retryAfter), 'Content-Type': 'text/plain' },
    });
  }
  return null;
}

// --- Per-Account Lockout ---
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

interface LockoutEntry { failures: number; firstFailure: number; lockedUntil: number; }
const accountLockoutMap = new Map<string, LockoutEntry>();

export function isAccountLocked(email: string): { locked: boolean; retryAfterSec?: number } {
  const key = email.toLowerCase();
  const entry = accountLockoutMap.get(key);
  if (!entry) return { locked: false };
  const now = Date.now();
  if (entry.lockedUntil > now) {
    return { locked: true, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (now > entry.firstFailure + LOCKOUT_WINDOW_MS) {
    accountLockoutMap.delete(key);
  }
  return { locked: false };
}

export function recordFailedLogin(email: string): void {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = accountLockoutMap.get(key);
  if (!entry || now > entry.firstFailure + LOCKOUT_WINDOW_MS) {
    accountLockoutMap.set(key, { failures: 1, firstFailure: now, lockedUntil: 0 });
    return;
  }
  entry.failures++;
  if (entry.failures >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
}

export function resetLoginAttempts(email: string): void {
  accountLockoutMap.delete(email.toLowerCase());
}

// --- CSRF Token ---
const CSRF_COOKIE = 'sl_csrf';

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
  for (const [key, entry] of accountLockoutMap) {
    const expiry = Math.max(entry.firstFailure + LOCKOUT_WINDOW_MS, entry.lockedUntil);
    if (now > expiry) accountLockoutMap.delete(key);
  }
}, 5 * 60 * 1000);

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next();

  const pathname = context.url.pathname;

  // Skip CSRF origin check for Bearer-auth API paths — Bearer tokens are not
  // auto-attached by browsers, so they are not vulnerable to CSRF attacks.
  const isBearerRequest = BEARER_PATHS.some(p => pathname.startsWith(p)) &&
    context.request.headers.get('authorization')?.startsWith('Bearer ');
  if (!isBearerRequest && !checkOrigin(context.request)) {
    return new Response('Forbidden — origin not allowed', { status: 403 });
  }

  const rateLimitResponse = checkRateLimit(context.request, pathname);
  if (rateLimitResponse) return rateLimitResponse;

  // Bearer token auth for scanner API paths
  const isBearerPath = BEARER_PATHS.some(p => pathname.startsWith(p));
  if (isBearerPath && context.request.headers.get('authorization')?.startsWith('Bearer ')) {
    const tokenAuth = validateBearerToken(context.request);
    if (tokenAuth) {
      // Minimal user object for API token auth
      context.locals.user = { id: tokenAuth.userId, email: '', displayName: null, subscriptionStatus: 'none', subscriptionTier: null, role: 'member', stripeCustomerId: null };
    } else {
      // Invalid/revoked bearer token — return 401, don't redirect to login
      return new Response(JSON.stringify({ error: 'Invalid or revoked token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    // Session validation (cookie-based)
    const sessionId = getSessionFromCookies(context.cookies);
    if (sessionId) {
      context.locals.user = validateSession(sessionId);
    } else {
      context.locals.user = null;
    }
  }

  // Resolve workspace context (own workspace or team workspace)
  if (context.locals.user) {
    const wsParam = context.url.searchParams.get('ws') || context.cookies.get('sl_workspace')?.value;
    context.locals.workspace = getWorkspaceContext(context.locals.user, wsParam || undefined);

    // Persist workspace selection in cookie
    if (wsParam && wsParam !== context.locals.user.id) {
      context.cookies.set('sl_workspace', wsParam, {
        path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60,
      });
    }
  } else {
    context.locals.workspace = null;
  }

  // Nonce for CSP
  const nonce = generateNonce();
  context.locals.nonce = nonce;

  // CSRF token
  let csrfToken = context.cookies.get(CSRF_COOKIE)?.value;
  if (!csrfToken) csrfToken = generateCsrfToken();
  context.cookies.set(CSRF_COOKIE, csrfToken, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 2,
    domain: undefined,  // No cross-domain sharing needed yet; set to .seayniclabs.com when SaaS launches
  });
  context.locals.csrfToken = csrfToken;

  // Protect /app/* routes (except login, register, forgot-password)
  const publicAppPaths = [
    '/app/login',
    '/app/register',
    '/app/forgot-password',
    '/app/reset-password',
    '/app/verify-email',
    '/app/api/webhooks/',
    '/app/api/billing-sync',
    '/app/api/community-sync', // public catalog sync; no auth (see community-sync.ts)
    '/app/auth/oidc',
    '/app/auth/callback',
    '/app/api/me',
  ];
  const isAppRoute = pathname.startsWith('/app/');
  const isPublicApp = publicAppPaths.some(p => pathname.startsWith(p));
  // These redirects fall through to security-header injection below
  let response: Response;

  if (isAppRoute && !isPublicApp && !context.locals.user) {
    response = context.redirect(`/app/login?redirect=${encodeURIComponent(pathname)}`);
  } else if (pathname.startsWith('/app/admin') && context.locals.user?.role !== 'superadmin') {
    response = context.redirect('/app');
  } else {
    response = await next();
  }

  // Security headers apply to ALL responses — redirects, HTML, API, etc.
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Redirects: set security headers directly on the original response to
  // preserve Set-Cookie headers from auth flows (re-wrapping can drop them).
  if (response.status >= 300 && response.status < 400) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return response;
  }

  // Non-HTML responses: return with security headers, no CSP nonce needed
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  // HTML responses: inject nonce into script tags and add full CSP
  const html = await response.text();
  const nonced = html.replace(/<script/g, `<script nonce="${nonce}"`);

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  newHeaders.set('Content-Security-Policy', csp);
  newHeaders.delete('content-length');

  return new Response(nonced, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
});

export function validateCsrf(formToken: string | null, cookies: any): boolean {
  const cookieToken = cookies.get(CSRF_COOKIE)?.value;
  if (!cookieToken || !formToken) return false;
  if (cookieToken.length !== formToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(formToken));
}
