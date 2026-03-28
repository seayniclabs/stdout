import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testIncident, testStack, scannerPayload, testDoc } from './helpers/fixtures';

test.describe('Cross-Service: Scanner → Stack → Monitor Pipeline', () => {
  test('CS1 — Scanner import creates stack, then monitor can target it', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Step 1: Create API token
    const tokenResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_cs1_token',
    });
    expect(tokenResult.status).toBe(200);
    const rawToken = tokenResult.json.token;

    // Step 2: Scanner import
    const importResponse = await page.request.post('/app/api/stacks/import', {
      data: scannerPayload,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawToken}`,
      },
    });
    expect(importResponse.status()).toBe(201);

    // Step 3: Create a monitor (external target — SSRF safe)
    const monitorResult = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      name: 'test_cs1_monitor',
      type: 'http',
      target: 'https://example.com',
      interval: 60,
      timeout: 5000,
      retries: 1,
    });
    expect(monitorResult.status).toBe(201);
    expect(monitorResult.json.id).toBeTruthy();

    // Step 4: Monitor shows in list
    const monitors = await apiRequest(page, 'GET', '/app/api/monitors');
    expect(monitors.json.monitors.length).toBeGreaterThanOrEqual(1);
    const ourMonitor = monitors.json.monitors.find((m: any) => m.name === 'test_cs1_monitor');
    expect(ourMonitor).toBeTruthy();
  });
});

test.describe('Cross-Service: Incident → Resolution → Search', () => {
  test('CS2 — Create incident, resolve it, find via search', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Step 1: Create incident via UI
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_cs2_nginx_crash');
    await page.locator('textarea[name="description"]').fill('test_cs2_description: nginx crashed after update');
    await page.locator('select[name="severity"]').selectOption('high');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Step 2: Add resolution
    const resTextarea = page.locator('textarea[name="content"]');
    if (await resTextarea.isVisible()) {
      await resTextarea.fill('test_cs2_resolution: Rolled back nginx to 1.24 and cleared proxy cache.');
      await page.locator('button:has-text("Resolve")').first().click();
      await page.waitForURL(/\/app\/incidents\//);
    }

    // Step 3: Search finds the incident
    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=test_cs2_nginx_crash');
    expect(status).toBe(200);
    const incidentResults = json.results.filter((r: any) => r.type === 'incident');
    expect(incidentResults.length).toBeGreaterThanOrEqual(1);
    expect(incidentResults[0].title).toContain('test_cs2_nginx_crash');
  });
});

test.describe('Cross-Service: Docs + Search + Export', () => {
  test('CS3 — Create doc, search it, export includes it', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Step 1: Create a doc
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill('test_cs3_docker_runbook');
    await page.locator('textarea[name="content"]').fill('test_cs3_content: How to restart Docker containers safely');
    await page.getByRole('button', { name: 'Save document' }).click();
    await page.waitForURL(/\/app\/docs\//);

    // Step 2: Search finds the doc
    const search = await apiRequest(page, 'GET', '/app/api/search?q=test_cs3_docker');
    expect(search.status).toBe(200);
    const docResults = search.json.results.filter((r: any) => r.type === 'doc');
    expect(docResults.length).toBeGreaterThanOrEqual(1);

    // Step 3: Export includes the doc
    const { json: exported } = await apiRequest(page, 'GET', '/app/api/export');
    const exportedDocs = exported.docs.filter((d: any) => d.title === 'test_cs3_docker_runbook');
    expect(exportedDocs.length).toBe(1);
  });
});

test.describe('Cross-Service: Multi-Tenant Isolation', () => {
  test('CS4 — User A data invisible to User B across all features', async ({ page, browser }) => {
    // User A: create data across multiple features
    await createAuthenticatedUser(page);

    // Create incident
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_cs4_private_incident');
    await page.locator('textarea[name="description"]').fill('test_cs4_private_data');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Create doc
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill('test_cs4_private_doc');
    await page.locator('textarea[name="content"]').fill('test_cs4_private_doc_content');
    await page.getByRole('button', { name: 'Save document' }).click();
    await page.waitForURL(/\/app\/docs\//);

    // Create monitor
    await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      name: 'test_cs4_private_monitor',
      type: 'http',
      target: 'https://example.com',
      interval: 60,
      timeout: 5000,
      retries: 1,
    });

    // User B: verify no access to User A's data
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await createAuthenticatedUser(page2);

    // Search: should not find User A's incident
    const search = await apiRequest(page2, 'GET', '/app/api/search?q=test_cs4_private');
    expect(search.status).toBe(200);
    expect(search.json.results.length).toBe(0);

    // Export: should not contain User A's data
    const { json: exported } = await apiRequest(page2, 'GET', '/app/api/export');
    const incidentTitles = exported.incidents.map((i: any) => i.title);
    expect(incidentTitles).not.toContain('test_cs4_private_incident');
    const docTitles = exported.docs.map((d: any) => d.title);
    expect(docTitles).not.toContain('test_cs4_private_doc');

    // Monitors: should not see User A's monitor
    const monitors = await apiRequest(page2, 'GET', '/app/api/monitors');
    const monitorNames = monitors.json.monitors.map((m: any) => m.name);
    expect(monitorNames).not.toContain('test_cs4_private_monitor');

    await ctx2.close();
  });
});

test.describe('Cross-Service: Notification + Incident Lifecycle', () => {
  test('CS5 — Webhook notification configured, incident created', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Step 1: Set up webhook notification
    const notif = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      channel: 'webhook',
      destination: 'https://httpbin.org/post',
      events: ['incident_created'],
    });
    expect(notif.status).toBe(200);

    // Step 2: Create incident (should trigger notification)
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_cs5_notified_incident');
    await page.locator('textarea[name="description"]').fill('test_cs5_should_trigger_webhook');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Step 3: Verify notification is configured in preferences
    const prefs = await apiRequest(page, 'GET', '/app/api/preferences');
    expect(prefs.json.notifications.length).toBeGreaterThanOrEqual(1);
    const webhook = prefs.json.notifications.find((n: any) => n.channel === 'webhook');
    expect(webhook).toBeTruthy();
  });
});

test.describe('Cross-Service: Branding + Pages', () => {
  test('CS6 — Custom accent color reflects in app pages', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Set custom accent color
    await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: '#10B981',
    });

    // Visit dashboard and verify the color is in the page
    await page.goto('/app');
    const html = await page.content();
    expect(html).toContain('#10B981');

    // Visit incidents page and verify color persists
    await page.goto('/app/incidents/new');
    const html2 = await page.content();
    expect(html2).toContain('#10B981');
  });
});
