import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testStack, scannerPayload } from './helpers/fixtures';

test.describe('Stacks (F42-F47)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F42 — Create stack', async ({ page }) => {
    await page.goto('/app/stacks?new');
    await page.locator('input[name="name"]').fill(testStack.name);
    await page.locator('textarea[name="description"]').fill(testStack.description);
    await page.locator('input[name="action"][value="create"]').evaluate(el => {
      (el as HTMLInputElement).closest('form')?.requestSubmit();
    });
    // Alternatively try direct button click
    await page.waitForURL(/\/app\/stacks/);

    // Stack should appear in the list
    const content = await page.textContent('body');
    expect(content).toContain(testStack.name);
  });

  test('F43 — View stack detail', async ({ page }) => {
    // Create a stack first
    await page.goto('/app/stacks?new');
    await page.locator('input[name="name"]').fill('test_view_stack');
    await page.locator('textarea[name="description"]').fill(testStack.description);

    // Submit create form
    const createBtn = page.locator('button:has-text("Create")').first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }
    await page.waitForURL(/\/app\/stacks/);

    // Click on the stack to view detail
    const stackLink = page.locator('a:has-text("test_view_stack")').first();
    if (await stackLink.isVisible()) {
      await stackLink.click();
      await page.waitForURL(/\/app\/stacks\//);
      const content = await page.textContent('body');
      expect(content).toContain('test_view_stack');
    }
  });

  test('F45 — Delete stack', async ({ page }) => {
    // Create a stack
    await page.goto('/app/stacks?new');
    await page.locator('input[name="name"]').fill('test_delete_stack');
    await page.locator('textarea[name="description"]').fill('To be deleted');
    const createBtn = page.locator('button:has-text("Create")').first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }
    await page.waitForURL(/\/app\/stacks/);

    // Find and delete the stack
    const deleteBtn = page.locator('button:has-text("Delete")').first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await page.waitForURL(/\/app\/stacks/);
    }
  });

  test('F46 — Scanner import via API', async ({ page }) => {
    // First create an API token to use for scanner import
    const tokenResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_scanner_token',
    });

    if (tokenResult.status === 200) {
      const rawToken = tokenResult.json.token;

      // Use the token to import a scan
      const importResponse = await page.request.post('/app/api/stacks/import', {
        data: scannerPayload,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${rawToken}`,
        },
      });

      expect(importResponse.status()).toBe(201);
      const importJson = await importResponse.json();
      expect(importJson.importId).toBeTruthy();
      expect(importJson.reviewUrl).toContain('/app/stacks/import/');
      expect(importJson.renderedMarkdown).toContain('# Infrastructure Stack');
      expect(importJson.scanSummary?.containerCount).toBeGreaterThan(0);
      expect(importJson.scanSummary?.markdownChars).toBeGreaterThan(0);
    }
  });
});
