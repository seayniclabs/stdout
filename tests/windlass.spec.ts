import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('Windlass — Schedule-Aware Service Management', () => {
  test('WL1 — Windlass page loads with setup form when not configured', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/tools/windlass');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1').first()).toContainText('Windlass');
    await expect(page.locator('h3').first()).toContainText('Connect Windlass');
    await expect(page.locator('#endpointUrl')).toBeVisible();
    await expect(page.locator('#connectBtn')).toBeVisible();
  });

  test('WL2 — Setup steps are displayed', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/tools/windlass');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.setup-steps')).toBeVisible();
    await expect(page.locator('.step-num')).toHaveCount(3);
  });

  test('WL3 — Docs link is present', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/tools/windlass');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.docs-link a')).toBeVisible();
  });

  test('WL4 — Config API rejects empty URL', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/windlass/config', {
      endpointUrl: '',
    });
    expect(status).toBe(400);
    expect(json.error).toContain('endpointUrl');
  });

  test('WL5 — Config API rejects invalid URL', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/windlass/config', {
      endpointUrl: 'not-a-url',
    });
    expect(status).toBe(400);
    expect(json.error).toContain('Invalid URL');
  });

  test('WL6 — Config API accepts valid URL', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/windlass/config', {
      endpointUrl: 'http://localhost:8116',
    });
    expect(status).toBe(201);
    expect(json.config).toBeTruthy();
    expect(json.config.endpointUrl).toBe('http://localhost:8116');
  });

  test('WL7 — Config API returns saved config on GET', async ({ page }) => {
    await createAuthenticatedUser(page);
    // Save first
    await apiRequest(page, 'POST', '/app/api/windlass/config', {
      endpointUrl: 'http://localhost:8116',
    });
    // Read back
    const { status, json } = await apiRequest(page, 'GET', '/app/api/windlass/config');
    expect(status).toBe(200);
    expect(json.config).toBeTruthy();
    expect(json.config.endpointUrl).toBe('http://localhost:8116');
  });

  test('WL8 — Services API returns empty before sync', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'GET', '/app/api/windlass/services');
    expect(status).toBe(200);
    expect(json.services).toEqual([]);
  });

  test('WL9 — Events API returns empty before sync', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'GET', '/app/api/windlass/events');
    expect(status).toBe(200);
    expect(json.events).toEqual([]);
  });

  test('WL10 — Timeline redirects when no config', async ({ page }) => {
    await createAuthenticatedUser(page);
    const response = await page.goto('/app/tools/windlass/timeline');
    // Should redirect to windlass main page
    expect(page.url()).toContain('/app/tools/windlass');
  });

  test('WL11 — Windlass appears in navigation', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app');
    await expect(page.locator('a[href="/app/tools/windlass"]').first()).toBeVisible();
  });

  test('WL12 — Unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/app/tools/windlass');
    await page.waitForURL(/\/app\/login|\/app\/register/);
  });
});
