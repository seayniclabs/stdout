import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testDoc } from './helpers/fixtures';

test.describe('Docs / Knowledge Base (F113-F117)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F113 — Create doc', async ({ page }) => {
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill(testDoc.title);
    await page.locator('textarea[name="content"]').fill(testDoc.content);
    await page.locator('select[name="docType"]').selectOption(testDoc.docType);
    await page.locator('input[name="tags"]').fill(testDoc.tags);
    await page.locator('button[type="submit"]').click();

    // Should redirect to doc detail
    await page.waitForURL(/\/app\/docs\//);
    const body = await page.textContent('body');
    expect(body).toContain(testDoc.title);
  });

  test('F114 — View doc', async ({ page }) => {
    // Create first
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill('test_view_doc');
    await page.locator('textarea[name="content"]').fill('test_view_doc_content');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/docs\//);

    // Verify content renders
    const body = await page.textContent('body');
    expect(body).toContain('test_view_doc');
    expect(body).toContain('test_view_doc_content');
  });

  test('F116 — List docs', async ({ page }) => {
    // Create a doc
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill('test_listed_doc');
    await page.locator('textarea[name="content"]').fill('test_listed_content');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/docs\//);

    // Visit docs list
    await page.goto('/app/docs');
    const body = await page.textContent('body');
    expect(body).toContain('test_listed_doc');
  });

  test('F117 — Doc search via FTS', async ({ page }) => {
    // Create a doc with searchable content
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill('test_fts_searchable_doc');
    await page.locator('textarea[name="content"]').fill('test_unique_fts_content_xyzzy');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/docs\//);

    // Search for it
    const { status, json } = await apiRequest(page, 'GET', '/app/api/search?q=test_unique_fts_content');
    expect(status).toBe(200);
    const docResults = json.results.filter((r: any) => r.type === 'doc');
    expect(docResults.length).toBeGreaterThanOrEqual(1);
  });

  test('F113-extra — Empty title/content rejected', async ({ page }) => {
    await page.goto('/app/docs/new');
    await page.locator('input[name="title"]').fill('');
    await page.locator('textarea[name="content"]').fill('');
    await page.locator('button[type="submit"]').click();

    // Should stay on the form (browser validation or server error)
    expect(page.url()).toContain('/docs/new');
  });
});
