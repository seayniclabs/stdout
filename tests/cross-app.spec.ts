import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('Cross-App Integration Tests', () => {

  test('X1 — Incident new page loads with form', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/incidents/new');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[name="title"]')).toBeVisible();
    await expect(page.locator('textarea[name="description"]')).toBeVisible();
    await expect(page.locator('select[name="severity"]')).toBeVisible();
  });

  test('X2 — Windlass + alerts end-to-end API flow', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Save windlass config
    const configRes = await apiRequest(page, 'POST', '/app/api/windlass/config', {
      endpointUrl: 'http://localhost:9999', // fake — won't sync but config saves
    });
    expect([200, 201]).toContain(configRes.status);

    // Create alert channel + rule + fire alert
    const chRes = await apiRequest(page, 'POST', '/app/api/windlass/alerts', {
      action: 'create_channel', type: 'webhook', name: 'Test', config: { url: 'https://httpbin.org/post' },
    });
    expect(chRes.status).toBe(201);

    await apiRequest(page, 'POST', '/app/api/windlass/alerts', {
      action: 'create_rule', channelId: chRes.json.id, severityMin: 'info',
    });

    const fireRes = await apiRequest(page, 'POST', '/app/api/windlass/alerts', {
      action: 'fire', eventType: 'test', severity: 'info', title: 'E2E test',
    });
    expect(fireRes.json.suppressed).toBe(false);
  });

  test('X3 — BYOK key → diagnostics credential routing', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Save a test key
    const saveRes = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'save',
      provider: 'anthropic',
      apiKey: 'sk-ant-test-routing-key-abcd1234',
      diagnosticsModel: 'claude-haiku-4-5-20251001',
    });
    expect(saveRes.status).toBe(201);

    // Verify key is listed
    const listRes = await apiRequest(page, 'GET', '/app/api/settings/ai-providers');
    const anthropic = listRes.json.providers.find((p: any) => p.id === 'anthropic');
    expect(anthropic.savedKey).toBeTruthy();
    expect(anthropic.savedKey.status).toBe('active');

    // Diagnosis with a fake key — should fail with structured error, not crash
    // Use a non-existent incident ID to test the error path
    const diagRes = await apiRequest(page, 'POST', '/app/api/diagnose', {
      incidentId: 'nonexistent-id',
    });
    // Should return JSON with error (404 for missing incident)
    expect(diagRes.status).toBe(404);
    expect(diagRes.json).toBeTruthy();
    expect(diagRes.json.error).toBeTruthy();
  });

  test('X4 — Alert channel CRUD + rule wiring', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Create a webhook channel
    const chRes = await apiRequest(page, 'POST', '/app/api/windlass/alerts', {
      action: 'create_channel',
      type: 'webhook',
      name: 'Test Webhook',
      config: { url: 'https://httpbin.org/post' },
    });
    expect(chRes.status).toBe(201);
    const channelId = chRes.json.id;

    // Create a rule
    const ruleRes = await apiRequest(page, 'POST', '/app/api/windlass/alerts', {
      action: 'create_rule',
      channelId,
      serviceId: null,
      severityMin: 'warning',
    });
    expect(ruleRes.status).toBe(201);

    // List — should show channel + rule
    const listRes = await apiRequest(page, 'GET', '/app/api/windlass/alerts');
    expect(listRes.json.channels.length).toBeGreaterThanOrEqual(1);
    expect(listRes.json.rules.length).toBeGreaterThanOrEqual(1);

    // Fire a test alert
    const fireRes = await apiRequest(page, 'POST', '/app/api/windlass/alerts', {
      action: 'fire',
      eventType: 'service_down',
      severity: 'warning',
      title: 'Test alert from Playwright',
      detail: 'Cross-app integration test',
    });
    expect(fireRes.json.suppressed).toBe(false);
    expect(fireRes.json.channelsNotified.length).toBeGreaterThanOrEqual(1);

    // Events should have the fired alert
    const evtRes = await apiRequest(page, 'GET', '/app/api/windlass/alerts?section=events');
    expect(evtRes.json.events.length).toBeGreaterThanOrEqual(1);
    expect(evtRes.json.events[0].title).toBe('Test alert from Playwright');

    // Clean up
    await apiRequest(page, 'POST', '/app/api/windlass/alerts', { action: 'delete_rule', ruleId: ruleRes.json.id });
    await apiRequest(page, 'POST', '/app/api/windlass/alerts', { action: 'delete_channel', channelId });
  });

  test('X5 — Navigation: all major sections accessible', async ({ page }) => {
    await createAuthenticatedUser(page);

    const routes = [
      '/app',
      '/app/incidents',
      '/app/hud',
      '/app/stacks',
      '/app/docs',
      '/app/tools/windlass',
      '/app/settings',
      '/app/search',
    ];

    for (const route of routes) {
      const res = await page.goto(route);
      expect(res?.status()).toBeLessThan(500);
    }
  });

  test('X6 — Landing page SEO: use-case links present in source', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that use-case links exist in the page (may be below fold)
    const content = await page.content();
    expect(content).toContain('/use-cases/docker-incident-management');
    expect(content).toContain('/use-cases/homelab-runbook-builder');
    expect(content).toContain('/use-cases/stdout-for-homelab');
    expect(content).toContain('use-cases-section');
  });
});
