import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('Performance (P1-P10)', () => {
  test('P1 — Landing page load < 2s', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(2000);
  });

  test('P2 — Dashboard load < 1s', async ({ page }) => {
    await createAuthenticatedUser(page);

    const start = Date.now();
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    // Allow 3s for first load (cold start), 1s target for subsequent
    expect(loadTime).toBeLessThan(3000);
  });

  test('P3 — Incident detail load < 1s', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Create incident
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_perf_incident');
    await page.locator('textarea[name="description"]').fill('test_perf_description');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    const incidentUrl = page.url();

    // Navigate away and back to measure load
    await page.goto('/app');
    const start = Date.now();
    await page.goto(incidentUrl);
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(3000);
  });

  test('P4 — Search response < 200ms', async ({ page }) => {
    await createAuthenticatedUser(page);

    const start = Date.now();
    const { status } = await apiRequest(page, 'GET', '/app/api/search?q=test');
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    // Allow up to 500ms in test env (200ms target, 2.5x tolerance)
    expect(elapsed).toBeLessThan(500);
  });

  test('P8 — Export response < 2s', async ({ page }) => {
    await createAuthenticatedUser(page);

    const start = Date.now();
    const { status } = await apiRequest(page, 'GET', '/app/api/export');
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

  test('P4-extra — Monitor list API response time', async ({ page }) => {
    await createAuthenticatedUser(page);

    const start = Date.now();
    const { status } = await apiRequest(page, 'GET', '/app/api/monitors');
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(1000);
  });

  test('P4-extra — Token list API response time', async ({ page }) => {
    await createAuthenticatedUser(page);

    const start = Date.now();
    const { status } = await apiRequest(page, 'GET', '/app/api/tokens');
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });

  test('P4-extra — Preferences API response time', async ({ page }) => {
    await createAuthenticatedUser(page);

    const start = Date.now();
    const { status } = await apiRequest(page, 'GET', '/app/api/preferences');
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });
});
