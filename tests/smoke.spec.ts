import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, logoutUser } from './helpers/auth';
import { testIncident } from './helpers/fixtures';

test.describe('Smoke Tests (S1-S6)', () => {
  test('S1 — App loads: landing page renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    // Should show content (not blank screen)
    const body = await page.locator('body').textContent();
    expect(body?.length).toBeGreaterThan(0);
  });

  test('S2 — Login works: register → redirected to /app', async ({ page }) => {
    await createAuthenticatedUser(page);
    expect(page.url()).toContain('/app');
  });

  test('S3 — Core action: create incident → view → add resolution → resolve', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Create incident
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill(testIncident.title);
    await page.locator('textarea[name="description"]').fill(testIncident.description);
    await page.locator('select[name="severity"]').selectOption(testIncident.severity);
    await page.getByRole('button', { name: 'Log incident' }).click();

    // Should redirect to incident detail
    await page.waitForURL(/\/app\/incidents\//);
    await expect(page.locator('h1').first()).toContainText(testIncident.title);

    // Add resolution and resolve
    const resolutionTextarea = page.locator('textarea[name="content"]');
    if (await resolutionTextarea.isVisible()) {
      await resolutionTextarea.fill('test_resolution: Restarted nginx container and cleared cache.');
      await page.locator('input[name="action"][value="resolve"]').evaluate(el => {
        (el as HTMLInputElement).closest('form')?.requestSubmit();
      });
      await page.waitForURL(/\/app\/incidents\//);
    }

    // Verify status shows resolved
    await expect(page.locator('.status-pill')).toContainText(/resolved/i);
  });

  test('S4 — Logout works: redirected to landing, session cleared', async ({ page }) => {
    await createAuthenticatedUser(page);
    await logoutUser(page);

    // Should be on landing page (root or login)
    const url = page.url();
    expect(url.includes('/app/login') || url.endsWith('/')).toBeTruthy();

    // Session cookie should be cleared
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'sl_session');
    expect(sessionCookie).toBeUndefined();
  });

  test('S5 — Health check: root returns 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });

  test('S6 — No console errors on landing and /app', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Landing page
    await page.goto('/');
    await page.waitForTimeout(1000);

    // App page (after auth)
    await createAuthenticatedUser(page);
    await page.goto('/app');
    await page.waitForTimeout(1000);

    // Filter out known acceptable errors (e.g., favicon, third-party, rate limits from test runs)
    const realErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('net::ERR') && !e.includes('429')
    );
    expect(realErrors).toEqual([]);
  });
});
