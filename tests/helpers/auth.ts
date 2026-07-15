import { type Page, type BrowserContext, expect } from '@playwright/test';

/**
 * Dismiss Vite error overlay if present.
 * In dev mode, server errors cause a persistent overlay that blocks interaction.
 */
export async function dismissViteOverlay(page: Page): Promise<void> {
  try {
    const overlay = page.locator('vite-error-overlay');
    if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.evaluate(() => {
        document.querySelector('vite-error-overlay')?.remove();
      });
    }
  } catch { /* no overlay */ }
}

const BASE_URL = process.env.STDOUT_TEST_URL || 'http://localhost:4321';

/** Generate a unique test email that won't collide with production data */
export function testEmail(suffix?: string): string {
  const id = suffix || Math.random().toString(36).slice(2, 10);
  return `test_playwright_${id}@example.com`;
}

/** Standard test password meeting 8-char minimum */
export const TEST_PASSWORD = 'Test1234!secure';

/** Standard test display name */
export const TEST_DISPLAY_NAME = 'test_playwright_user';

/**
 * Register a new test user via the register form.
 * Returns the email used.
 */
export async function registerUser(
  page: Page,
  options?: { email?: string; password?: string; displayName?: string; redirect?: string }
): Promise<{ email: string; password: string }> {
  const email = options?.email || testEmail();
  const password = options?.password || TEST_PASSWORD;
  const displayName = options?.displayName || TEST_DISPLAY_NAME;

  const url = options?.redirect
    ? `/app/register?redirect=${encodeURIComponent(options.redirect)}`
    : '/app/register';

  await page.goto(url);
  await dismissViteOverlay(page);

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="displayName"]').fill(displayName);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm"]').fill(password);
  await page.locator('button[type="submit"]').click();

  try {
    await page.waitForURL(/\/app(?!\/register)/, { timeout: 5000 });
  } catch (err) {
    const errorLocator = page.locator('.auth-error');
    if (await errorLocator.isVisible().catch(() => false)) {
      const errorMsg = await errorLocator.textContent();
      console.error(`[registerUser] Registration failed for ${email} with error: ${errorMsg}`);
    } else {
      console.error(`[registerUser] Registration timed out for ${email} without visible error. Current URL: ${page.url()}`);
    }
    throw err;
  }

  return { email, password };
}

/**
 * Log in programmatically via Playwright's API request context.
 * Extracts the CSRF token from the login page, POSTs credentials, and injects
 * the returned session cookie into the page's browser context.
 * Use this to avoid browser form Origin-header issues and the IP rate limiter.
 */
export async function apiLogin(page: Page, email: string, password: string): Promise<void> {
  const context = page.context();
  const reqCtx = await context.request;

  // GET /app/login to get CSRF cookie + token
  const loginPageResp = await reqCtx.get('/app/login');
  const html = await loginPageResp.text();
  const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrfToken = csrfMatch?.[1] || '';

  // POST credentials
  await reqCtx.post('/app/login', {
    form: { email, password, _csrf: csrfToken, redirect: '/app' },
  });

  // Navigate to /app — cookies from reqCtx are shared with the browser context
  await page.goto('/app');
  // If still on login, the login failed
  if (page.url().includes('/login')) {
    throw new Error(`apiLogin failed for ${email} — still on login page`);
  }
}

/**
 * Log in an existing user via the login form.
 */
export async function loginUser(
  page: Page,
  email: string,
  password: string,
  options?: { redirect?: string }
): Promise<void> {
  const url = options?.redirect
    ? `/app/login?redirect=${encodeURIComponent(options.redirect)}`
    : '/app/login';

  await page.goto(url);
  await dismissViteOverlay(page);

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

  await page.waitForURL(/\/app(?!\/login)/);
}

/**
 * Get or create an authenticated session for tests.
 *
 * When STDOUT_TEST_EMAIL + STDOUT_TEST_PASSWORD are set (frozen-registration env),
 * the session is already loaded via storageState in playwright.config.ts — this
 * function just navigates to /app to confirm the session is active.
 *
 * In open-registration environments (dev/local), registers a fresh user.
 */
export async function createAuthenticatedUser(
  page: Page,
  options?: { email?: string }
): Promise<{ email: string; password: string }> {
  const testEmail = process.env.STDOUT_TEST_EMAIL;
  const testPassword = process.env.STDOUT_TEST_PASSWORD;

  if (testEmail && testPassword) {
    // storageState is pre-loaded — navigate to /app to confirm the session.
    // If a previous test logged out (invalidating the server-side session),
    // clear the stale cookies first so apiLogin gets a fresh CSRF token,
    // then re-authenticate via the API path.
    await page.goto('/app');
    if (page.url().includes('/login')) {
      await page.context().clearCookies();
      await apiLogin(page, testEmail, testPassword);
    }
    return { email: testEmail, password: testPassword };
  }

  const result = await registerUser(page, { email: options?.email });
  // After registration, we should be redirected to /app (session cookie set)
  await page.waitForURL(/\/app(?!\/register)/);
  return result;
}

/**
 * Get the session cookie value from page context.
 */
export async function getSessionCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find(c => c.name === 'sl_session')?.value;
}

/**
 * Get the CSRF cookie value from page context.
 */
export async function getCsrfCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find(c => c.name === 'sl_csrf')?.value;
}

/**
 * Get the CSRF token from a page's hidden form field.
 */
export async function getCsrfTokenFromPage(page: Page): Promise<string> {
  return await page.locator('input[name="_csrf"]').first().inputValue();
}

/**
 * Make an authenticated API request using the page's cookies.
 */
export async function apiRequest(
  page: Page,
  method: string,
  path: string,
  body?: any
): Promise<{ status: number; json: any; headers: Record<string, string> }> {
  const isXml = typeof body === 'string' && body.trim().startsWith('<');
  const contentType = isXml ? 'application/xml' : 'application/json';
  const response = await page.request[method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](
    path,
    body !== undefined ? { data: body, headers: { 'Content-Type': contentType } } : undefined
  );
  const status = response.status();
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // Not JSON
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers())) {
    headers[key] = value;
  }
  return { status, json, headers };
}

/**
 * Perform a raw fetch (no browser cookies) for security tests.
 */
export async function rawFetch(
  path: string,
  options?: RequestInit
): Promise<{ status: number; text: string; headers: Headers }> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
  });
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

/**
 * Log out the current user.
 */
export async function logoutUser(page: Page): Promise<void> {
  await page.goto('/app/logout');
  // The logout page has a single form with a submit button
  await page.locator('form button[type="submit"]').click();
  // After POST, server redirects to / (or OIDC logout URL)
  await page.waitForURL(url => {
    const path = new URL(url).pathname;
    return path === '/' || path.includes('/login');
  }, { timeout: 10000 });
}
