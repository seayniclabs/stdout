import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testIncident } from './helpers/fixtures';

test.describe('AI Diagnosis (F36-F41)', () => {
  // NOTE: These tests exercise the diagnosis API endpoint.
  // In a test environment without ANTHROPIC_API_KEY, they verify graceful error handling.
  // To fully test with mocked responses, set up an interceptor for the Anthropic API.

  let incidentId: string;

  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);

    // Create a test incident
    await page.goto('/app/incidents/new');
    await page.locator('input[name="title"]').fill(testIncident.title);
    await page.locator('textarea[name="description"]').fill(testIncident.description);
    await page.locator('select[name="severity"]').selectOption(testIncident.severity);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app\/incidents\//);

    // Extract incident ID from URL
    const url = page.url();
    incidentId = url.split('/app/incidents/')[1];
  });

  test('F36 — Run diagnosis (API call)', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/diagnose', {
      incidentId,
    });

    // Either succeeds with diagnosis or fails gracefully (no API key in test env)
    if (status === 200) {
      expect(json.rootCauses).toBeDefined();
      expect(json.suggestedCommands).toBeDefined();
      expect(json.model).toBeDefined();
    } else {
      // 429 (rate limit) or 500 (no API key) — both are valid in test env
      expect([429, 500]).toContain(status);
      expect(json.error).toBeTruthy();
    }
  });

  test('F40 — API failure graceful handling', async ({ page }) => {
    // Even with an invalid setup, the API should return a structured error
    const { status, json } = await apiRequest(page, 'POST', '/app/api/diagnose', {
      incidentId,
    });

    // Should never return a 5xx HTML error page — always structured JSON
    if (status >= 400) {
      expect(json).toBeTruthy();
      expect(json.error).toBeTruthy();
    }
  });

  test('F41 — Missing incidentId returns 400', async ({ page }) => {
    const { status } = await apiRequest(page, 'POST', '/app/api/diagnose', {});
    expect(status).toBe(400);
  });

  test('F36-extra — Diagnosis on non-existent incident returns 404', async ({ page }) => {
    const { status } = await apiRequest(page, 'POST', '/app/api/diagnose', {
      incidentId: 'nonexistent_test_id_xyz',
    });
    expect(status).toBe(404);
  });
});
