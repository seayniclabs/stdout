import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testIncident } from './helpers/fixtures';

test.describe('Search — FTS5 (F48-F54)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);

    // Create a test incident so there's something to search for
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill(testIncident.title);
    await page.locator('textarea[name="description"]').fill(testIncident.description);
    await page.locator('select[name="severity"]').selectOption(testIncident.severity);
    await page.getByRole('button', { name: 'Log incident' }).click();
    await page.waitForURL(/\/app\/incidents\//);
  });

  test('F48 — Search incidents by title', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=test_nginx');

    expect(status).toBe(200);
    expect(json.results).toBeDefined();
    // Should find our test incident
    const incidentResults = json.results.filter((r: any) => r.type === 'incident');
    expect(incidentResults.length).toBeGreaterThanOrEqual(1);
    expect(incidentResults[0].title).toContain('test_nginx');
  });

  test('F50 — Search docs (when docs exist)', async ({ page }) => {
    // Create a doc first
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill('test_searchable_doc');
    await page.locator('textarea[name="content"]').fill('test_searchable_content for docker restart');
    await page.getByRole('button', { name: 'Save document' }).click();
    await page.waitForURL(/\/app\/docs\//);

    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=test_searchable');
    expect(status).toBe(200);
    const docResults = json.results.filter((r: any) => r.type === 'doc');
    expect(docResults.length).toBeGreaterThanOrEqual(1);
  });

  test('F51 — Short query (< 2 chars) returns empty', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=a');
    expect(status).toBe(200);
    expect(json.results).toEqual([]);
  });

  test('F52 — No results for nonsense string', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=xyzzy_nonsense_qwertyuiop');
    expect(status).toBe(200);
    expect(json.results).toEqual([]);
  });

  test('F53 — Multi-word search (OR logic)', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=test_nginx deploy');
    expect(status).toBe(200);
    expect(json.results).toBeDefined();
    // Should match on either word
  });

  test('F54 — Search scoped to user', async ({ page, browser }) => {
    // Create a second user and verify they can't see User A's incidents
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await createAuthenticatedUser(page2);

    const { status, json } = await apiRequest(page2, 'GET', '/app/api/search?q=test_nginx');
    expect(status).toBe(200);
    // User B should not see User A's incidents
    const incidentResults = json.results.filter(
      (r: any) => r.type === 'incident' && r.title?.includes('test_nginx_502')
    );
    expect(incidentResults.length).toBe(0);

    await context2.close();
  });
});
