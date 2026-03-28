import { type Page, type BrowserContext, expect } from '@playwright/test';

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

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="displayName"]').fill(displayName);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm"]').fill(password);
  await page.locator('button[type="submit"]').click();

  return { email, password };
}

/**
 * Log in an existing user via the OIDC-less login form.
 * NOTE: StdOut login page auto-redirects to OIDC when enabled.
 * This helper works when OIDC is disabled (dev/test mode).
 * For OIDC-enabled environments, use loginViaAPI instead.
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
  // The login page may auto-redirect to OIDC. If we see the OIDC button,
  // it means password login is not available (OIDC-only mode).
  // For tests, we register first (which sets a session cookie).
}

/**
 * Register a fresh user and return an authenticated page.
 * This is the primary way to get an auth'd context for tests.
 */
export async function createAuthenticatedUser(
  page: Page,
  options?: { email?: string }
): Promise<{ email: string; password: string }> {
  const result = await registerUser(page, { email: options?.email });
  // After registration, we should be redirected to /app (session cookie set)
  await page.waitForURL(/\/app/);
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
  const response = await page.request[method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](
    path,
    body ? { data: body, headers: { 'Content-Type': 'application/json' } } : undefined
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
  const csrfToken = await getCsrfTokenFromPage(page);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/^\//);
}
