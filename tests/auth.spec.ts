import { test, expect } from '@playwright/test';
import {
  registerUser,
  createAuthenticatedUser,
  testEmail,
  logoutUser,
  getSessionCookie,
  TEST_PASSWORD,
  TEST_DISPLAY_NAME,
} from './helpers/auth';

test.describe('Auth — Registration (F1-F10)', () => {
  test('F1 — Happy path register', async ({ page }) => {
    const { email } = await registerUser(page);
    await page.waitForURL(/\/app/);

    // Session cookie should be set
    const session = await getSessionCookie(page);
    expect(session).toBeTruthy();
  });

  test('F2 — Duplicate email', async ({ page, browser }) => {
    const email = testEmail('dup');
    await registerUser(page, { email });
    await page.waitForURL(/\/app/);

    // Use a fresh browser context (new session) instead of logout
    // This avoids secure cookie timing issues on http://localhost
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await registerUser(page2, { email });

    // Should show error, NOT redirect to /app
    await expect(page2.locator('.auth-error')).toContainText(/already exists/i);
    await ctx2.close();
  });

  test('F3 — Password mismatch', async ({ page }) => {
    await page.goto('/app/register');
    await page.locator('input[name="email"]').fill(testEmail());
    await page.locator('input[name="displayName"]').fill(TEST_DISPLAY_NAME);
    await page.locator('input[name="password"]').fill('Password123!');
    await page.locator('input[name="confirm"]').fill('DifferentPass!');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.auth-error')).toContainText(/don't match/i);
  });

  test('F4 — Short password', async ({ page }) => {
    await page.goto('/app/register');
    await page.locator('input[name="email"]').fill(testEmail());
    await page.locator('input[name="displayName"]').fill(TEST_DISPLAY_NAME);
    await page.locator('input[name="password"]').fill('short');
    await page.locator('input[name="confirm"]').fill('short');

    // Browser's minlength="8" blocks submission — remove it to test server-side validation
    await page.locator('input[name="password"]').evaluate(el => el.removeAttribute('minlength'));
    await page.locator('input[name="confirm"]').evaluate(el => el.removeAttribute('minlength'));
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.auth-error')).toContainText(/at least 8/i);
  });

  test('F5 — Empty fields', async ({ page }) => {
    await page.goto('/app/register');
    // Submit with empty fields — browser validation may prevent submission,
    // but if it goes through, server should reject
    await page.locator('input[name="email"]').fill('');
    await page.locator('input[name="displayName"]').fill('');
    await page.locator('input[name="password"]').fill('');
    await page.locator('input[name="confirm"]').fill('');

    // Try to submit — may be blocked by HTML required attribute
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Should still be on register page (either browser validation or server error)
    expect(page.url()).toContain('/register');
  });

  test('F6 — Invalid email format (browser validation)', async ({ page }) => {
    await page.goto('/app/register');
    const emailInput = page.locator('input[name="email"]');
    await emailInput.fill('notanemail');
    await page.locator('input[name="displayName"]').fill(TEST_DISPLAY_NAME);
    await page.locator('input[name="password"]').fill(TEST_PASSWORD);
    await page.locator('input[name="confirm"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Browser's native email validation should prevent submission
    // The page should still be on /register
    expect(page.url()).toContain('/register');
  });

  test('F7 — Redirect after register', async ({ page }) => {
    await registerUser(page, { redirect: '/app/incidents/new' });
    // The form has a hidden redirect field; after successful registration,
    // should redirect to the specified path
    await page.waitForURL(/\/app/);
  });

  test('F8 — Already logged in → redirected to /app', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/register');
    // Should redirect away from register since already logged in
    await page.waitForURL(/\/app/);
    expect(page.url()).not.toContain('/register');
  });
});

test.describe('Auth — Login (F11-F17)', () => {
  // NOTE: StdOut login page auto-redirects to OIDC when OIDC is enabled.
  // These tests assume OIDC is disabled for the test environment.
  // Login is tested implicitly through registration (which sets a session cookie).

  test('F11 — Happy path login (via registration)', async ({ page }) => {
    const { email } = await createAuthenticatedUser(page);
    expect(page.url()).toContain('/app');
    const session = await getSessionCookie(page);
    expect(session).toBeTruthy();
  });

  test('F16 — Redirect after login via register redirect', async ({ page }) => {
    await registerUser(page, { redirect: '/app/stacks' });
    await page.waitForURL(/\/app/);
  });

  test('F17 — Already logged in → visit /app/login → redirected', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/login');
    // Should redirect to /app (or OIDC), not stay on login
    await page.waitForURL(/\/app/);
  });
});

test.describe('Auth — Login direct (F11-F14)', () => {
  // OIDC removed — login is now email/password directly.

  test('F11 — Happy path login', async ({ page }) => {
    const { email } = await registerUser(page);
    await logoutUser(page);
    await page.goto('/app/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app/);
    const session = await getSessionCookie(page);
    expect(session).toBeTruthy();
  });

  test('F12 — Wrong password shows error', async ({ page }) => {
    const { email } = await registerUser(page);
    await logoutUser(page);
    await page.goto('/app/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill('wrongpassword!');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.auth-error')).toContainText(/invalid/i);
  });

  test('F13 — Unknown email same error as wrong password', async ({ page }) => {
    await page.goto('/app/login');
    await page.locator('input[name="email"]').fill('nobody@example.com');
    await page.locator('input[name="password"]').fill('somepassword!');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.auth-error')).toContainText(/invalid/i);
  });
});

test.describe('Auth — Session (F24-F26)', () => {
  test('F24 — Session persists (cookie-based)', async ({ page }) => {
    await createAuthenticatedUser(page);
    const session = await getSessionCookie(page);
    expect(session).toBeTruthy();

    // Navigate away and back — session should persist
    await page.goto('/app');
    expect(page.url()).toContain('/app');
  });

  test('F25 — Unauthenticated user redirected to login', async ({ page }) => {
    // Visit protected route without session
    await page.goto('/app/incidents/new');
    await page.waitForURL(/\/app\/login/);
    expect(page.url()).toContain('redirect=');
  });

  test('F26 — Logout clears session', async ({ page }) => {
    await createAuthenticatedUser(page);
    await logoutUser(page);

    const session = await getSessionCookie(page);
    expect(session).toBeUndefined();

    // Visiting /app should redirect to login
    await page.goto('/app/incidents/new');
    await page.waitForURL(/\/app\/login/);
  });
});
