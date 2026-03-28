import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('Preferences / Branding (F108-F112)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F108 — Set workspace name', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      workspaceName: 'test_workspace_name',
    });

    expect(status).toBe(200);
    expect(json.updated).toBe(true);

    // Verify it persisted
    const get = await apiRequest(page, 'GET', '/app/api/preferences');
    expect(get.json.branding?.workspaceName).toBe('test_workspace_name');
  });

  test('F109 — Set accent color', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: '#3B82F6',
    });

    expect(status).toBe(200);
    expect(json.updated).toBe(true);

    const get = await apiRequest(page, 'GET', '/app/api/preferences');
    expect(get.json.branding?.accentColor).toBe('#3B82F6');
  });

  test('F110 — Clear accent color', async ({ page }) => {
    // Set first
    await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: '#FF5722',
    });

    // Clear
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: '',
    });

    expect(status).toBe(200);

    // Should be null/empty now
    const get = await apiRequest(page, 'GET', '/app/api/preferences');
    expect(get.json.branding?.accentColor).toBeNull();
  });

  test('F111 — Invalid accent color stored but not rendered', async ({ page }) => {
    // The API stores whatever is sent; the Layout regex is the validation gate.
    // Submit an invalid color
    const { status } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'update_branding',
      accentColor: 'red',
    });

    expect(status).toBe(200);

    // The API stores it, but Layout.astro won't render it (regex: /^#[0-9a-fA-F]{3,8}$/)
    // We verify the API accepted it (the Layout rendering is a separate concern)
    const get = await apiRequest(page, 'GET', '/app/api/preferences');
    // Value stored as-is — Layout ignores non-hex values
    expect(get.json.branding?.accentColor).toBe('red');
  });
});
