import { defineMiddleware } from 'astro:middleware';
import { validateSession, getSessionFromCookies, SESSION_COOKIE, getUserCount, sessionCookieOptions } from './lib/auth';
import { getDb, schema } from './lib/db';
import { eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { startHeartbeat } from './lib/scanner-heartbeat';
import { scheduleCveScanner } from './lib/scanner-cve';
import { scheduleDockerHubScanner } from './lib/scanner-docker-hub';
import { scheduleShodanScanner } from './lib/scanner-shodan';
import { getStoredLicense } from './lib/license';
import { initializeDegradationMode } from './lib/observatory/degradation-mode';
import { initAutoWiring } from './lib/auto-wire';
import { startWatcher } from './lib/observatory/watcher';

// Initialize Observatory (full initialization with baseline establishment)
(async () => {
  try {
    const { initializeObservatory } = await import('./lib/observatory/initialization');
    const result = await initializeObservatory();

    // Log full startup sequence
    for (const line of result.startupLog) {
      console.log('[Observatory]', line);
    }

    if (result.success) {
      console.log('[Observatory] ✓ Initialization complete');
      console.log(`  Agents: ${result.agentsActivated.join(', ')}`);
      console.log(`  Baselines: ${result.baselinesEstablished}`);
      console.log(`  Monitors: ${result.monitorsConfigured}`);
    } else {
      console.error('[Observatory] ✗ Initialization failed:', result.errors);
    }
  } catch (err) {
    console.error('[middleware] Failed to initialize Observatory:', err);
  }
})();

// Initialize degradation mode check
initializeDegradationMode().catch(err =>
  console.error('[middleware] Failed to initialize degradation mode:', err)
);

// Initialize event bus auto-wiring (cross-links entities when events fire)
initAutoWiring();

// Start the Observatory Watcher loop (polls stacks, detects anomalies)
startWatcher();

// Start the Autonomous Agent Watcher (Riggins monitors and acts)
setTimeout(async () => {
  try {
    const { startAutonomousWatcher } = await import('./lib/agent/autonomous-watcher');
    startAutonomousWatcher();
  } catch (err) {
    console.error('[middleware] Failed to start autonomous agent watcher:', err);
  }
}, 3000);

// Auto-start all monitors on boot (runs after DB init completes)
setTimeout(async () => {
  try {
    const { startAllMonitors } = await import('./lib/hud');
    startAllMonitors();
  } catch (err) {
    console.error('[middleware] Failed to auto-start monitors:', err);
  }
}, 2000);

// Auto-detect Windlass on startup (tries common endpoints)
setTimeout(async () => {
  try {
    const { autoDetectAndConfigure } = await import('./lib/windlass');
    const { getSqlite } = await import('./lib/db');

    // Try to detect Windlass for each user
    const db = getSqlite();
    const users = db.prepare('SELECT id FROM users').all() as Array<{ id: string }>;

    for (const user of users) {
      const detected = await autoDetectAndConfigure(user.id);
      if (detected) {
        console.log(`[middleware] Windlass auto-detected for user ${user.id}`);
      }
    }
  } catch (err) {
    console.error('[middleware] Windlass auto-detection failed:', err);
  }
}, 5000); // Run after monitors start

// --- Bearer Token Auth (for scanner API + Observatory) ---
const BEARER_PATHS = [
  '/app/api/stacks/import',
  '/app/api/windlass/event',
  '/app/api/netdata/webhook',
  '/app/api/suricata/webhook',
  '/app/api/zeek/ingest',
  '/app/api/wazuh/webhook',          // Phase 3: Wazuh Host IDS
  '/app/api/cve/ingest',             // Phase 3: CVE scanners (Trivy/Grype)
  '/app/api/velociraptor/instant-ir', // Phase 4: Velociraptor Instant IR
  '/app/api/velociraptor/isolate',   // Phase 4: Emergency isolation
  '/app/api/scanner/autodiscover',
  '/app/api/observatory/tool',
  '/app/api/network/scan',
  '/app/api/comms/inbound/', // Voice incident CLI + Sonique (BB15)
  '/app/api/discovery/schema/validate',
  '/app/api/discovery/ingest',
];

function validateBearerToken(request: Request): { userId: string } | null {
  const authHeader = request.headers.get('authorization');
  console.log('[validateBearerToken] authHeader:', authHeader ? authHeader.slice(0, 30) + '...' : 'null');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const rawToken = authHeader.slice(7);
  console.log('[validateBearerToken] rawToken prefix:', rawToken.slice(0, 15));
  console.log('[validateBearerToken] prefix check:', rawToken.startsWith('stdout_scan_') ? 'PASS' : 'FAIL');
  if (!rawToken.startsWith('stdout_scan_')) return null;

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  console.log('[validateBearerToken] tokenHash:', tokenHash.slice(0, 20) + '...');

  const row = getDb()
    .select({
      id: schema.apiTokens.id,
      userId: schema.apiTokens.userId,
      expiresAt: schema.apiTokens.expiresAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.tokenHash, tokenHash))
    .get();

  console.log('[validateBearerToken] row found:', row ? 'YES' : 'NO');
  if (!row) return null;

  // Check token expiration
  const now = new Date();
  if (row.expiresAt && row.expiresAt < now) {
    console.log(
      JSON.stringify({
        level: 'WARN',
        module: 'middleware',
        timestamp: now.toISOString(),
        msg: 'Bearer token expired',
        userId: row.userId,
        expiresAt: row.expiresAt.toISOString(),
      })
    );
    return null;
  }

  // Update last_used_at
  getDb().update(schema.apiTokens)
    .set({ lastUsedAt: now })
    .where(eq(schema.apiTokens.id, row.id))
    .run();

  return { userId: row.userId };
}

// --- CSRF Origin Check ---
const ALLOWED_ORIGINS: string[] = [];

// Customer-configured production URL (set via APP_URL env var)
if (process.env.APP_URL) {
  ALLOWED_ORIGINS.push(process.env.APP_URL.replace(/\/$/, ''));
}

// Development and localhost ports
ALLOWED_ORIGINS.push(
  'http://localhost:4321',  // Astro dev default
  'http://localhost:3000',  // Production build default
  'http://localhost:8112',  // Dev alternate
  'http://localhost:9112'   // SSH tunnel
);

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isOriginAllowed(originUrl: string): boolean {
  // Exact match against allowed origins
  if (ALLOWED_ORIGINS.includes(originUrl)) return true;

  try {
    const url = new URL(originUrl);

    // Allow any *.local mDNS hostname (Home Assistant style)
    if (url.hostname.endsWith('.local')) {
      console.log('[checkOrigin] allowing .local mDNS:', url.hostname);
      return true;
    }

    // Allow private IP ranges (RFC 1918)
    const ip = url.hostname;
    if (
      ip.startsWith('192.168.') ||    // 192.168.0.0/16
      ip.startsWith('10.') ||          // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)  // 172.16.0.0/12
    ) {
      console.log('[checkOrigin] allowing private IP:', ip);
      return true;
    }

    // Localhost variants
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
      return true;
    }

  } catch {
    return false;
  }

  return false;
}

function checkOrigin(request: Request): boolean {
  if (!MUTATING_METHODS.has(request.method)) return true;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  console.log('[checkOrigin] method:', request.method, 'origin:', origin, 'referer:', referer);

  // Allow requests with no Origin header if Referer matches (same-origin navigation)
  if (!origin) {
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        const isAllowed = isOriginAllowed(refererOrigin);
        console.log('[checkOrigin] using referer:', refererOrigin, 'allowed:', isAllowed);
        return isAllowed;
      } catch {
        console.log('[checkOrigin] invalid referer URL');
        return false;
      }
    }
    console.log('[checkOrigin] no origin or referer');
    return false;
  }

  const isAllowed = isOriginAllowed(origin);
  console.log('[checkOrigin] origin check:', isAllowed);
  return isAllowed;
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
  const isAuthPath = RATE_LIMITED_PATHS.some(p => pathname === p || pathname === p + '/');
  if (!isAuthPath) return null;
  const windowMs = RATE_LIMIT_WINDOW_MS;
  const maxReqs = RATE_LIMIT_MAX;

  const ip = getClientIp(request);
  const key = `${ip}:${pathname}`;
  const now = Date.now();

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;
  if (entry.count > maxReqs) {
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

// Windlass auto-sync — runs every 60s, checks each user's configured interval
setInterval(async () => {
  try {
    const { syncFromEndpoint, getConfig } = await import('./lib/windlass');
    const users = getDb().select({ id: schema.users.id }).from(schema.users).all();
    const now = Date.now();
    for (const u of users) {
      try {
        const cfg = getConfig(u.id);
        if (!cfg || !cfg.enabled) continue;
        const intervalMs = (cfg.syncIntervalSeconds || 60) * 1000;
        const lastSync = cfg.lastSyncAt ? new Date(cfg.lastSyncAt).getTime() : 0;
        if (now - lastSync >= intervalMs) {
          syncFromEndpoint(u.id).catch(() => {});
        }
      } catch (error: unknown) { /* Intentionally ignored */ }
    }
  } catch (error: unknown) { /* Intentionally ignored */ }
}, 60 * 1000);

// Weekly digest timer — runs every Monday at 8 AM CT (14:00 UTC)
// Checks once per hour; only fires if it's Monday 14:xx UTC and hasn't run today
let lastDigestDate = '';
setInterval(async () => {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  const hour = now.getUTCHours();
  const dateStr = now.toISOString().split('T')[0];

  if (dayOfWeek === 1 && hour === 14 && lastDigestDate !== dateStr) {
    lastDigestDate = dateStr;
    try {
      const { sendWeeklyDigests } = await import('./lib/digest');
      const sent = await sendWeeklyDigests();
      console.log(`[digest] Weekly digest sent to ${sent} user(s)`);
    } catch (err) {
      console.error('[digest] Weekly digest failed:', err);
    }
  }
}, 60 * 60 * 1000); // Check every hour

// Community library sync — daily at 03:00 UTC, pulls new/updated docs from stdout.seayniclabs.com/library
let lastCommunitySyncDate = '';
setInterval(async () => {
  const now = new Date();
  const hour = now.getUTCHours();
  const dateStr = now.toISOString().split('T')[0];
  if (hour !== 3 || lastCommunitySyncDate === dateStr) return;
  lastCommunitySyncDate = dateStr;
  try {
    const { syncCommunityLibrary } = await import('./lib/community-kb');
    const { getCentralDb, centralSchema } = await import('./lib/db');
    const users = getDb().select({ id: schema.users.id })
      .from(schema.users).all();
    for (const u of users) {
      const summary = await syncCommunityLibrary(u.id);
      if (!summary.skipped && (summary.added || summary.updated || summary.removed)) {
        console.log(`[community-sync] user=${u.id} +${summary.added}/~${summary.updated}/-${summary.removed} v=${summary.syncVersion}`);
      }
    }
  } catch (err) {
    console.error('[community-sync] daily sync failed:', err);
  }
}, 60 * 60 * 1000); // Check every hour, fires once at 03:xx UTC

// Windlass Phase 3 — native scanner modules (replace n8n heartbeat + weekly scanners)
startHeartbeat();
scheduleCveScanner();
scheduleDockerHubScanner();
scheduleShodanScanner();

// Suricata EVE ingest (file-tail / Redis) — keystone security signal → Windlass IP-block
import('./lib/suricata-ingest')
  .then(({ startSuricataIngestors }) => startSuricataIngestors())
  .catch((err) => console.error('[middleware] failed to start Suricata ingest:', err));

// Observatory initialization moved to top of file (initializeObservatory with full Phase 4.5 baseline establishment)

// First-run detection — redirect to setup page if installation incomplete
let installationComplete = false;
(async () => {
  try {
    // Check if database file exists first
    const fs = await import('fs');
    const dbPath = process.env.DB_PATH || '/data/stdout-central.db';

    if (!fs.existsSync(dbPath)) {
      console.log('[Setup] First run detected - database does not exist');
      installationComplete = false;
      return;
    }

    const db = getDb();

    // Check if installation has been completed
    const result = await db.get(sql`
      SELECT value FROM system_state WHERE key = 'installation_complete'
    `) as { value: string } | undefined;

    installationComplete = result?.value === 'true';

    if (!installationComplete) {
      console.log('[Setup] First run detected - installation incomplete');
    }
  } catch (error) {
    // Silently handle errors - assume installation is incomplete
    installationComplete = false;
  }
})();

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next();

  const pathname = context.url.pathname;

  // Skip CSRF origin check for Bearer-auth API paths — Bearer tokens are not
  // auto-attached by browsers, so they are not vulnerable to CSRF attacks.
  const isBearerRequest = BEARER_PATHS.some(p => pathname.startsWith(p)) &&
    context.request.headers.get('authorization')?.startsWith('Bearer ');

  // Skip CSRF origin check for test-only endpoints (only active in non-production)
  const isTestEndpoint = pathname.startsWith('/app/api/test/');

  // Skip CSRF origin check for setup endpoints (no auth required during setup wizard)
  // Also skip for comms inbound webhooks (external channels query infrastructure status)
  const isSetupEndpoint = pathname.startsWith('/app/api/network/scan') ||
                          pathname.startsWith('/app/api/network/import') ||
                          pathname.startsWith('/app/api/setup/install-windlass') ||
                          pathname.startsWith('/app/api/setup/install-observatory') ||
                          pathname.startsWith('/app/api/comms/inbound/');

  if (!isBearerRequest && !isTestEndpoint && !isSetupEndpoint && !checkOrigin(context.request)) {
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
      context.locals.user = { id: tokenAuth.userId, email: '', displayName: null, role: 'member' };
      console.log('[middleware] Bearer auth successful, locals.user set for:', pathname);
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



  // Nonce for CSP
  const nonce = generateNonce();
  context.locals.nonce = nonce;

  // CSRF token
  let csrfToken = context.cookies.get(CSRF_COOKIE)?.value;
  if (!csrfToken) csrfToken = generateCsrfToken();
  const csrfOpts = sessionCookieOptions(60 * 60 * 2);
  context.cookies.set(CSRF_COOKIE, csrfToken, { ...csrfOpts, domain: undefined });
  context.locals.csrfToken = csrfToken;

  // First-run installation check — redirect to /app/setup if incomplete
  // Skip this check for auth pages, API endpoints, initial setup wizard, and the app setup page
  const setupExcludedPaths = ['/app/login', '/app/register', '/app/forgot-password', '/app/reset-password', '/app/verify-email', '/app/setup', '/app/api/setup/', '/setup'];
  const shouldCheckInstallation = context.locals.user &&
    !pathname.startsWith('/app/api/') &&
    !pathname.startsWith('/app/setup') &&
    !pathname.startsWith('/setup') &&
    !setupExcludedPaths.some(p => pathname.startsWith(p));

  if (shouldCheckInstallation && !installationComplete) {
    // Re-check DB in case installation completed after startup (installer runs after app starts)
    try {
      const db = getDb();
      const result = await db.get(sql`
        SELECT value FROM system_state WHERE key = 'installation_complete'
      `) as { value: string } | undefined;
      installationComplete = result?.value === 'true';
    } catch {
      installationComplete = false;
    }
    if (!installationComplete) {
      console.log('[Setup] Redirecting to /app/setup - installation incomplete');
      return context.redirect('/app/setup');
    }
  }

  // Protect /app/* routes (except login, register, forgot-password)
  const publicAppPaths = [
    '/app/login',
    '/app/register',
    '/app/forgot-password',
    '/app/reset-password',
    '/app/verify-email',
    '/app/api/webhooks/',
    '/app/api/community-sync',
    '/app/api/me',
    '/app/api/scanner/autodiscover',
    '/app/api/network/scan',
    '/app/api/network/import',
    '/app/api/setup/install-windlass',
    '/app/api/setup/install-observatory',
    '/app/api/test/',
    '/app/api/health', // Health check for monitoring systems (rate-limited: 100 req/15min)
    '/app/api/satellite/ping', // unauthenticated discovery endpoint — satellites probe this before setup
    '/app/api/comms/inbound/', // External channels (Sonique, SMS, webhooks) can query infrastructure status
    '/app/api/suricata/status', // Prometheus scrape (?format=prometheus); JSON still requires session
  ];
  const isAppRoute = pathname.startsWith('/app/');
  const isPublicApp = publicAppPaths.some(p => pathname.startsWith(p));

  if (pathname === '/setup') {
    const userCount = getUserCount();
    console.log('[middleware] /setup accessed, userCount:', userCount);
    // Only redirect to login if setup is actually complete
    // Don't redirect just because a user exists - they might be mid-setup
    if (userCount > 0) {
      const { isSetupComplete } = await import('./lib/setup');
      const setupComplete = await isSetupComplete();
      if (setupComplete) {
        return context.redirect('/app/login');
      }
    }
  } else if (pathname === '/setup/license') {
    // Allow access to license page after admin creation
    if (getUserCount() === 0) {
      return context.redirect('/setup');
    }
  } else if (getUserCount() === 0 && (isAppRoute || pathname === '/app') && !isPublicApp) {
    if (pathname.startsWith('/app/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized — setup required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect('/setup');
  } else if (getUserCount() > 0 && !getStoredLicense() && (isAppRoute || pathname === '/app') && !isPublicApp) {
    // License required for all /app/* routes (except public paths)
    // BUT: if setup is complete OR user just registered, allow access (offline mode)
    const { isSetupComplete } = await import('./lib/setup');
    const setupComplete = await isSetupComplete();
    if (!setupComplete) {
      if (pathname.startsWith('/app/api/')) {
        return new Response(JSON.stringify({ error: 'Unauthorized — license required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect('/setup/license');
    }
  }

  let response: Response;

  if (isAppRoute && !isPublicApp && !context.locals.user) {
    if (pathname.startsWith('/app/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.log('[middleware] Redirecting to login:', pathname, 'user:', context.locals.user ? 'YES' : 'NO');
    response = context.redirect(`/app/login?redirect=${encodeURIComponent(pathname)}`);
  } else if (pathname.startsWith('/app/admin') && context.locals.user?.role !== 'superadmin') {
    response = context.redirect('/app');
  } else {
    console.log('[middleware] Calling next() for:', pathname, 'user:', context.locals.user ? 'YES' : 'NO');
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

  // Relaxed CSP for setup wizard (pre-auth, needs inline scripts)
  const isSetupPage = pathname.startsWith('/setup');
  const csp = isSetupPage
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://analytics.seaynicroute.com https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self' https://analytics.seaynicroute.com https://cdn.jsdelivr.net ws://localhost:5683 ws://192.168.68.89:5683 ws://stdout.local:5683",
        "frame-ancestors 'none'",
      ].join('; ')
    : [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://analytics.seaynicroute.com https://cdn.jsdelivr.net`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self' https://analytics.seaynicroute.com https://cdn.jsdelivr.net ws://localhost:5683 ws://192.168.68.89:5683 ws://stdout.local:5683",
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

export function validateCsrf(formToken: string | null, cookies: Record<string, string>): boolean {
  const cookieToken = cookies.get(CSRF_COOKIE)?.value;
  if (!cookieToken || !formToken) return false;
  if (cookieToken.length !== formToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(formToken));
}
