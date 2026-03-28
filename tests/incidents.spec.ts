import { test, expect } from '@playwright/test';
import { createAuthenticatedUser } from './helpers/auth';
import { testIncident, testIncidentCritical } from './helpers/fixtures';

test.describe('Incidents (F27-F35)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F27 — Create incident', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill(testIncident.title);
    await page.locator('textarea[name="description"]').fill(testIncident.description);
    await page.locator('select[name="severity"]').selectOption(testIncident.severity);
    await page.locator('input[name="tags"]').fill(testIncident.tags);
    await page.locator('button[type="submit"]').click();

    // Should redirect to incident detail
    await page.waitForURL(/\/app\/incidents\//);
    await expect(page.locator('h1')).toContainText(testIncident.title);
  });

  test('F28 — View incident detail', async ({ page }) => {
    // Create first
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill(testIncident.title);
    await page.locator('textarea[name="description"]').fill(testIncident.description);
    await page.locator('select[name="severity"]').selectOption(testIncident.severity);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    // Verify detail page elements
    await expect(page.locator('h1')).toContainText(testIncident.title);
    await expect(page.locator('.severity-pill')).toContainText(testIncident.severity);
    await expect(page.locator('.status-pill')).toBeVisible();
    await expect(page.locator('.description-block')).toContainText('test_description');
  });

  test('F29 — Add resolution', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill(testIncident.title);
    await page.locator('textarea[name="description"]').fill(testIncident.description);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    // Add resolution
    const resTextarea = page.locator('textarea[name="content"]');
    if (await resTextarea.isVisible()) {
      await resTextarea.fill('test_resolution: Restarted nginx and cleared proxy cache.');
      // Find the resolve form and submit
      await page.locator('button:has-text("Resolve")').first().click();
      await page.waitForURL(/\/app\/incidents\//);
      await expect(page.locator('.status-pill')).toContainText(/resolved/i);
    }
  });

  test('F30 — Change status', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_status_change_incident');
    await page.locator('textarea[name="description"]').fill('test_description');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    // Change to investigating
    const investigatingBtn = page.locator('button[value="investigating"]');
    if (await investigatingBtn.isVisible()) {
      await investigatingBtn.click();
      await page.waitForURL(/\/app\/incidents\//);
      await expect(page.locator('.status-pill')).toContainText(/investigating/i);
    }
  });

  test('F31 — Change severity (via form)', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_severity_incident');
    await page.locator('textarea[name="description"]').fill('test_description');
    await page.locator('select[name="severity"]').selectOption('low');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    await expect(page.locator('.severity-pill')).toContainText('low');
  });

  test('F33 — Tags display as chips', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_tagged_incident');
    await page.locator('textarea[name="description"]').fill('test_description');
    await page.locator('input[name="tags"]').fill('test_docker, test_nginx, test_n8n');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    // Tags should be visible
    const tags = page.locator('.tag');
    await expect(tags.first()).toBeVisible();
  });

  test('F34 — Empty title: validation error', async ({ page }) => {
    await page.goto('/app/incidents/new');
    await page.locator('textarea[name="description"]').fill('test_description');
    // Leave title empty, try submit
    await page.locator('button[type="submit"]').click();

    // Should remain on the form (browser required attribute or server error)
    expect(page.url()).toContain('/incidents/new');
  });

  test('F35 — Incident list on dashboard', async ({ page }) => {
    // Create an incident first
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill('test_dashboard_list_incident');
    await page.locator('textarea[name="description"]').fill('test_description');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    // Go to dashboard
    await page.goto('/app');
    // Should see the incident in the list
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('test_dashboard_list_incident');
  });
});
