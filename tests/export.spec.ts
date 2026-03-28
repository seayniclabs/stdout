import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testIncident } from './helpers/fixtures';

test.describe('Data Export (F103-F107)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F103 — Export own data', async ({ page }) => {
    // Create some data first
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_export_incident');
    await page.locator('textarea[name="description"]').fill('test_export_description');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    const { status, json, headers } = await apiRequest(page, 'GET', '/app/api/export');
    expect(status).toBe(200);

    // Verify export structure
    expect(json.exportedAt).toBeTruthy();
    expect(json.user).toBeDefined();
    expect(json.user.id).toBeTruthy();
    expect(json.stacks).toBeDefined();
    expect(json.incidents).toBeDefined();
    expect(json.resolutions).toBeDefined();
    expect(json.diagnoses).toBeDefined();
    expect(json.docs).toBeDefined();
  });

  test('F105 — Export scoping: only own data', async ({ page, browser }) => {
    // Create data as User A
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_user_a_private_incident');
    await page.locator('textarea[name="description"]').fill('test_private_data');
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);

    // Create User B and export
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await createAuthenticatedUser(page2);

    const { status, json } = await apiRequest(page2, 'GET', '/app/api/export');
    expect(status).toBe(200);

    // User B's export should NOT contain User A's incident
    const incidentTitles = json.incidents.map((i: any) => i.title);
    expect(incidentTitles).not.toContain('test_user_a_private_incident');

    await context2.close();
  });

  test('F106 — Export filename header', async ({ page }) => {
    const response = await page.request.get('/app/api/export');
    const disposition = response.headers()['content-disposition'];
    expect(disposition).toContain('stdout-export-');
    expect(disposition).toContain('.json');
  });

  test('F103-extra — Export requires auth', async ({ page }) => {
    // Clear cookies and try to export
    await page.context().clearCookies();
    const response = await page.request.get('/app/api/export');
    const status = response.status();
    // Middleware redirects unauthenticated to login (302), which page.request follows → 200 from login page.
    // The critical check: the response should NOT contain export data.
    const text = await response.text();
    expect(text).not.toContain('"exportedAt"');
  });
});
