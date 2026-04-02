/**
 * Playwright global-setup: create a logged-in storageState for the test user.
 *
 * Uses Playwright's API request context (not browser UI) to avoid Origin
 * header issues in headless mode. Extracts the CSRF token from the login page,
 * then POSTs credentials with the correct Origin + CSRF headers.
 *
 * When STDOUT_TEST_EMAIL + STDOUT_TEST_PASSWORD are set (frozen-registration
 * environment), logs in once and writes the session to playwright/.auth/member.json.
 * Tests inherit this state automatically via playwright.config.ts `storageState`.
 */
import { chromium, request as apiRequest, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_FILE = path.join(process.cwd(), 'playwright', '.auth', 'member.json');

export default async function globalSetup(config: FullConfig) {
  const testEmail = process.env.STDOUT_TEST_EMAIL;
  const testPassword = process.env.STDOUT_TEST_PASSWORD;
  const baseURL = process.env.STDOUT_TEST_URL || 'http://localhost:4321';

  if (!testEmail || !testPassword) {
    // Open-registration mode — no pre-login needed
    return;
  }

  // Ensure auth directory exists
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  // Use API request context to avoid browser Origin-header behaviour in headless mode
  const ctx = await apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: { 'Origin': baseURL },
  });

  try {
    // Step 1: GET /app/login to receive the CSRF cookie and token
    const loginPageResp = await ctx.get('/app/login');
    const html = await loginPageResp.text();
    const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
    const csrfToken = csrfMatch?.[1];
    if (!csrfToken) {
      throw new Error('[global-setup] Could not extract CSRF token from login page');
    }

    // Step 2: POST credentials
    const loginResp = await ctx.post('/app/login', {
      form: {
        email: testEmail,
        password: testPassword,
        _csrf: csrfToken,
        redirect: '/app',
      },
    });

    if (loginResp.status() >= 400) {
      const body = await loginResp.text();
      throw new Error(`[global-setup] Login POST returned ${loginResp.status()}: ${body.slice(0, 200)}`);
    }

    // Step 3: Build storageState manually from the cookies set by the API context
    // The API context holds cookies internally — save them to the auth file.
    const storageState = await ctx.storageState();
    const sessionCookie = storageState.cookies.find(c => c.name === 'sl_session');
    if (!sessionCookie) {
      throw new Error('[global-setup] No sl_session cookie after login — check credentials and container state');
    }

    fs.writeFileSync(AUTH_FILE, JSON.stringify(storageState, null, 2));
    console.log(`[global-setup] Saved storageState for ${testEmail}`);
  } finally {
    await ctx.dispose();
  }
}
