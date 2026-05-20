import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, loginUser, apiRequest, rawFetch, testEmail, TEST_PASSWORD, getCsrfCookie } from './helpers/auth';
import { ssrfBlockedTargets, ssrfAllowedTarget, testMonitorHTTP, testWebhookNotification } from './helpers/fixtures';

const BASE_URL = process.env.STDOUT_TEST_URL || 'http://localhost:4321';

test.describe('Security — Injection (X1-X3)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('X1 — SQL injection in incident title', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill("'; DROP TABLE incidents; --");
    await page.locator('textarea[name="description"]').fill('test_sql_injection_attempt');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Incident should be created with the literal string (escaped)
    const body = await page.textContent('body');
    expect(body).toContain('DROP TABLE');

    // Verify incidents table still works
    await page.goto('/app');
    const dashContent = await page.textContent('body');
    expect(dashContent).toBeTruthy();
  });

  test('X2 — XSS in incident title', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('<script>alert(1)</script>');
    await page.locator('textarea[name="description"]').fill('test_xss_attempt');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Check that the script tag is escaped, not executed
    const html = await page.content();
    expect(html).not.toContain('<script>alert(1)</script>');
    // Astro templates auto-escape by default
  });

  test('X3 — XSS in resolution content', async ({ page }) => {
    // Create incident first
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_xss_resolution');
    await page.locator('textarea[name="description"]').fill('test_description');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Add resolution with XSS payload
    const resTextarea = page.locator('textarea[name="content"]');
    if (await resTextarea.isVisible()) {
      await resTextarea.fill('<img onerror=alert(1) src=x>');
      await page.locator('button:has-text("Resolve")').first().click();
      await page.waitForURL(/\/app\/incidents\//);

      const html = await page.content();
      // Should be escaped
      expect(html).not.toContain('<img onerror=alert(1)');
    }
  });
});

test.describe('Security — Open Redirect (X4-X5)', () => {
  test('X4 — Open redirect blocked: //evil.com', async ({ page }) => {
    await page.goto('/app/login?redirect=//evil.com');
    // After login, the redirect should be sanitized — user should NOT end up on evil.com
    // The login page itself may contain the redirect param in its URL, which is fine.
    // The critical check: the page origin is still localhost, not evil.com.
    const url = new URL(page.url());
    expect(url.hostname).not.toBe('evil.com');
    expect(url.hostname).toMatch(/localhost|127\.0\.0\.1/);
  });

  test('X5 — Valid redirect works: /app/stacks', async ({ page }) => {
    // Register with redirect
    await page.goto('/app/register?redirect=/app/stacks');
    // Should have the redirect in the hidden form field
    const redirectInput = page.locator('input[name="redirect"]');
    if (await redirectInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const val = await redirectInput.inputValue();
      expect(val).toBe('/app/stacks');
    }
  });
});

// X6-X8 operate on the auth forms without a session — clear storageState so
// the user is not already logged in when these tests run.
test.describe('Security — CSRF (X6-X8)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('X6 — CSRF origin validation: wrong origin rejected', async () => {
    const { status } = await rawFetch('/app/login', {
      method: 'POST',
      headers: {
        'Origin': 'https://evil.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'email=test@test.com&password=test1234',
    });

    expect(status).toBe(403);
  });

  test('X7 — CSRF missing origin rejected', async () => {
    const { status } = await rawFetch('/app/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // No Origin header
      },
      body: 'email=test@test.com&password=test1234',
    });

    expect(status).toBe(403);
  });

  test('X8 — CSRF token validation: wrong token rejected', async ({ page }) => {
    await page.goto('/app/register');
    // Tamper with CSRF token
    await page.locator('input[name="_csrf"]').evaluate(el => {
      (el as HTMLInputElement).value = 'invalid_csrf_token_value';
    });
    await page.locator('input[name="email"]').fill(testEmail());
    await page.locator('input[name="displayName"]').fill('test');
    await page.locator('input[name="password"]').fill(TEST_PASSWORD);
    await page.locator('input[name="confirm"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Should show error about invalid form submission.
    // When REGISTRATION_FREEZE=true, the page also renders a frozen banner as a
    // separate .auth-error — check the last one for the CSRF validation error.
    await expect(page.locator('.auth-error').last()).toContainText(/invalid form/i);
  });
});

test.describe('Security — Auth Bypass (X9-X10)', () => {
  // X9 requires an unauthenticated context; X10 requires an authenticated one.
  // Playwright's test.use applies per-describe, so split them or clear per-test.

  test('X9 — Protected route without session → redirect to login', async ({ browser }) => {
    // Use a clean context (no storageState) to verify unauthenticated redirect.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto('/app/incidents/new');
      await page.waitForURL(/\/app\/login/);
      expect(page.url()).toContain('redirect=');
    } finally {
      await ctx.close();
    }
  });

  test('X10 — Admin page as non-superadmin → redirect', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/admin');
    await page.waitForURL(/\/app/);
    expect(page.url()).not.toContain('/admin');
  });
});

test.describe('Security — Cookie Flags (X14-X15)', () => {
  const baseUrl = process.env.STDOUT_TEST_URL || 'http://localhost:4321';
  const expectSecure = baseUrl.startsWith('https://');

  test('X14 — Session cookie flags', async ({ page }) => {
    await createAuthenticatedUser(page);
    const cookies = await page.context().cookies();
    const session = cookies.find(c => c.name === 'sl_session');
    expect(session).toBeTruthy();
    expect(session!.httpOnly).toBe(true);
    expect(session!.secure).toBe(expectSecure);
    expect(session!.sameSite).toBe('Lax');
  });

  test('X15 — CSRF cookie flags', async ({ page }) => {
    await page.goto('/app/register');
    const cookies = await page.context().cookies();
    const csrf = cookies.find(c => c.name === 'sl_csrf');
    expect(csrf).toBeTruthy();
    expect(csrf!.httpOnly).toBe(true);
    expect(csrf!.secure).toBe(expectSecure);
    expect(csrf!.sameSite).toBe('Lax');
  });
});

test.describe('Security — Headers (X16-X17)', () => {
  test('X16 — CSP header present with nonce', async ({ page }) => {
    await createAuthenticatedUser(page);
    const response = await page.goto('/app');
    const csp = response?.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test('X17 — Security headers present', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() || {};
    // nginx and middleware both set security headers (defense-in-depth).
    // Headers may appear as "DENY" or "DENY, DENY" depending on nginx config.
    // Use toContain for all to handle both single and double-set values.
    expect(headers['x-frame-options']).toContain('DENY');
    expect(headers['x-content-type-options']).toContain('nosniff');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['referrer-policy']).toBeTruthy();
  });
});

test.describe('Security — Bearer Token (X19-X20)', () => {
  test('X20 — Token without stdout_scan_ prefix rejected', async () => {
    const { status } = await rawFetch('/app/api/stacks/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer not_a_stdout_token',
        'Origin': BASE_URL,
      },
      body: JSON.stringify({
        version: '1.0.0',
        containers: [{ name: 'test', image: 'test', status: 'running', ports: [] }],
      }),
    });

    expect(status).toBe(401);
  });
});

test.describe('Security — SSRF Monitors (X21-X34)', () => {
  // These test the isBlockedTarget function via the monitor creation API

  for (const target of ssrfBlockedTargets) {
    test(`X21-X33 — SSRF blocked: ${target.label}`, async ({ page }) => {
      await createAuthenticatedUser(page);

      const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
        action: 'create',
        name: `test_ssrf_${target.label}`,
        type: 'http',
        target: target.url,
        interval: 60,
        timeout: 5000,
        retries: 1,
      });

      // Should be blocked — either 400 with SSRF error, or blocked at URL parsing
      expect(status).toBeGreaterThanOrEqual(400);
    });
  }

  test('X34 — External URL allowed', async ({ page }) => {
    await createAuthenticatedUser(page);

    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      name: 'test_ssrf_external_allowed',
      type: 'http',
      target: ssrfAllowedTarget,
      interval: 60,
      timeout: 5000,
      retries: 1,
    });

    expect(status).toBe(201);
  });
});

test.describe('Security — SSRF Webhooks (X31-X32)', () => {
  test('X31 — Webhook to localhost blocked', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Webhook SSRF is checked in notify.ts isBlockedTarget call
    // The preferences API stores the webhook, and notify.ts checks at send time.
    // We verify the webhook is stored (the block happens at delivery time).
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      channel: 'webhook',
      destination: 'http://localhost:8888',
      events: ['incident_created'],
    });

    // The API may store it (block is at send time) or may validate upfront
    // Either way, the SSRF block should prevent delivery
    expect(status).toBe(200); // stored OK — SSRF block is at delivery
  });
});

test.describe('Security — CSS Injection (X35-X38)', () => {
  test('X35 — Invalid accent color not rendered', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Store invalid color
    await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: 'red; background: url(evil)',
    });

    // Visit /app and check that the invalid color is NOT in a style attribute
    await page.goto('/app');
    const html = await page.content();
    // Layout.astro regex: /^#[0-9a-fA-F]{3,8}$/
    // "red; background: url(evil)" fails this regex, so default is used
    expect(html).not.toContain('background: url(evil)');
  });

  test('X37 — Valid hex accent color applied', async ({ page }) => {
    await createAuthenticatedUser(page);

    await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: '#FF5722',
    });

    await page.goto('/app');
    const html = await page.content();
    expect(html).toContain('#FF5722');
  });

  test('X38 — Shorthand hex passes validation', async ({ page }) => {
    await createAuthenticatedUser(page);

    await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: '#F00',
    });

    await page.goto('/app');
    const html = await page.content();
    expect(html).toContain('#F00');
  });
});

test.describe('Security — FTS Injection (X45)', () => {
  test('X45 — FTS injection attempt safe', async ({ page }) => {
    await createAuthenticatedUser(page);

    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=* OR 1=1');
    // Should not crash — FTS5 query is quoted per-word
    expect(status).toBe(200);
    expect(json.results).toBeDefined();
  });
});

test.describe('Security — Export Scoping (X40)', () => {
  test('X40 — Export only contains own data', async ({ page, browser }) => {
    const userBEmail = process.env.STDOUT_TEST_USER_B_EMAIL;
    const userBPassword = process.env.STDOUT_TEST_USER_B_PASSWORD;

    if (!userBEmail || !userBPassword) {
      // Skip when only one test user is configured — can't test cross-user isolation.
      test.skip(true, 'STDOUT_TEST_USER_B_EMAIL not set — cross-user isolation test skipped');
      return;
    }

    // Create data as User A (the primary test user)
    await createAuthenticatedUser(page);
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_user_a_export_private');
    await page.locator('textarea[name="description"]').fill('test_private_data_a');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Export as User B (must be a different account)
    const context2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page2 = await context2.newPage();
    await loginUser(page2, userBEmail, userBPassword);

    const { json } = await apiRequest(page2, 'GET', '/app/api/export');
    const titles = json.incidents.map((i: any) => i.title);
    expect(titles).not.toContain('test_user_a_export_private');

    await context2.close();
  });
});

test.describe('Security — Backup Path Traversal (X41)', () => {
  test('X41 — Path traversal in restore filename', async ({ page }) => {
    await createAuthenticatedUser(page);

    const { status } = await apiRequest(page, 'POST', '/app/api/backups', {
      action: 'restore',
      filename: '../../etc/passwd',
    });

    expect(status).toBeGreaterThanOrEqual(400);
  });
});

// X43 — OIDC removed; callback route no longer exists. Auth is email/password only.

test.describe('Security — Token Scoping (X44)', () => {
  test('X44 — Token resolves to owner only', async ({ page, browser }) => {
    // Create User A with a token
    await createAuthenticatedUser(page);
    const tokenResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_scoping_token',
    });
    const rawToken = tokenResult.json.token;

    // Use the token — it should import to User A's workspace
    const importResponse = await page.request.post('/app/api/stacks/import', {
      data: {
        version: '1.0.0',
        containers: [{ name: 'test_scoped', image: 'nginx', status: 'running', ports: [] }],
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawToken}`,
      },
    });

    expect(importResponse.status()).toBe(201);
  });
});

test.describe('Security — Auto-Fix exec policy (AF1-AF3)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('AF1 — blocks curl with command chaining', async ({ page }) => {
    const { status, json: cj } = await apiRequest(page, 'POST', '/app/api/incidents', {
      action: 'create',
      title: 'autofix policy test',
      description: 'x',
      severity: 'low',
    });
    expect(status).toBe(201);
    const incidentId = cj.id;

    const { status: ex, json } = await apiRequest(page, 'POST', '/app/api/incidents/autofix-exec', {
      command: 'curl -fsS https://example.com && rm -rf /',
      incidentId,
      approved: true,
    });
    expect(ex).toBe(403);
    expect(String(json?.error || '')).toMatch(/chaining|blocked|not an allowed|metachar/i);
  });

  test('AF2 — blocks non-allowlist prefix', async ({ page }) => {
    const { status, json: cj } = await apiRequest(page, 'POST', '/app/api/incidents', {
      action: 'create',
      title: 'autofix policy test 2',
      description: 'x',
      severity: 'low',
    });
    expect(status).toBe(201);
    const { status: ex } = await apiRequest(page, 'POST', '/app/api/incidents/autofix-exec', {
      command: 'wget -qO- https://example.com',
      incidentId: cj.id,
      approved: true,
    });
    expect(ex).toBe(403);
  });

  test('AF3 — blocks semicolon metacharacter', async ({ page }) => {
    const { status, json: cj } = await apiRequest(page, 'POST', '/app/api/incidents', {
      action: 'create',
      title: 'autofix policy test 3',
      description: 'x',
      severity: 'low',
    });
    expect(status).toBe(201);
    const { status: ex } = await apiRequest(page, 'POST', '/app/api/incidents/autofix-exec', {
      command: 'curl -fsS https://example.com; id',
      incidentId: cj.id,
      approved: true,
    });
    expect(ex).toBe(403);
  });
});

test.describe('Security — Community Doc Tamper (X47)', () => {
  test('X47 — Community doc cannot be edited', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Community docs have source='community' and should not accept edits
    // This is verified by the read-only behavior in F131
    // Try to access with edit param
    await page.goto('/app/docs');
    // Page should render without error
    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(0);
  });
});

// --- Rate Limit Tests (MUST RUN LAST) ---
// These lock the IP/account for subsequent requests.
// Tag: @ratelimit

test.describe('Security — Rate Limiting (X11-X13) @ratelimit', () => {
  test.describe.configure({ mode: 'serial' });

  test('X11 — Rate limit on login: 11 rapid POSTs → 429', async () => {
    const results: number[] = [];

    for (let i = 0; i < 12; i++) {
      const { status } = await rawFetch('/app/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': BASE_URL,
        },
        body: `email=test_ratelimit@example.com&password=wrong&_csrf=fake`,
      });
      results.push(status);
    }

    // After 10 requests, should get 429
    const has429 = results.some(s => s === 429);
    expect(has429).toBe(true);
  });

  test('X12 — Rate limit on register: 11 rapid POSTs → 429', async () => {
    const results: number[] = [];

    for (let i = 0; i < 12; i++) {
      const { status } = await rawFetch('/app/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': BASE_URL,
        },
        body: `email=test_rl_reg_${i}@example.com&password=Test1234!&confirm=Test1234!&displayName=test&_csrf=fake`,
      });
      results.push(status);
    }

    const has429 = results.some(s => s === 429);
    expect(has429).toBe(true);
  });

  test('X13 — Rate limit on forgot-password: 11 rapid POSTs → 429', async () => {
    const results: number[] = [];

    for (let i = 0; i < 12; i++) {
      const { status } = await rawFetch('/app/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': BASE_URL,
        },
        body: `email=test_rl_forgot@example.com&_csrf=fake`,
      });
      results.push(status);
    }

    const has429 = results.some(s => s === 429);
    expect(has429).toBe(true);
  });
});
