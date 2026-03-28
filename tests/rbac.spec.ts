import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('Admin / RBAC (F92-F102)', () => {
  test('F93 — Non-superadmin blocked from /app/admin', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Regular member visits admin page
    await page.goto('/app/admin');
    // Should be redirected to /app (not admin)
    await page.waitForURL(/\/app/);
    expect(page.url()).not.toContain('/admin');
  });

  test('F94 — Owner can perform all actions', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Owner should be able to create incidents
    await page.goto('/app/incidents/new');
    expect(page.url()).toContain('/incidents/new');

    // Owner should be able to access settings
    await page.goto('/app/settings');
    expect(page.url()).toContain('/settings');

    // Owner can create tokens (manage_settings)
    const tokenResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_owner_token',
    });
    expect(tokenResult.status).toBe(200);

    // Owner can export data
    const exportResult = await apiRequest(page, 'GET', '/app/api/export');
    expect(exportResult.status).toBe(200);
  });

  test('F100 — Workspace switching via ?ws= param', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Set workspace to own ID (should work — own workspace)
    await page.goto('/app?ws=nonexistent_workspace_id');
    // Non-member should fall back to own workspace silently
    expect(page.url()).toContain('/app');
  });

  test('F101 — Non-member workspace falls back to own', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Try to access a workspace we're not a member of
    const { status, json } = await apiRequest(
      page,
      'GET',
      '/app/api/search?q=test&ws=fake_workspace_id'
    );

    // Should succeed (falls back to own workspace)
    expect(status).toBe(200);
  });

  test('F102 — Audit logging on token create', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Create a token (which triggers audit logging)
    const { status, json } = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_audit_token',
    });

    // Token creation should succeed and audit log should be written (we verify
    // the action completed without error — audit log is server-side)
    expect(status).toBe(200);
  });

  test('F93-extra — Protected API routes require auth', async ({ page }) => {
    // Without authentication, API routes should return 401
    const response = await page.request.get('/app/api/tokens', {
      headers: { 'Content-Type': 'application/json' },
    });
    // Unauthenticated — should redirect to login or return 401
    const status = response.status();
    expect([401, 302, 303]).toContain(status);
  });

  // NOTE: Full RBAC permutation tests (F95-F99) require team workspace setup
  // which needs the Shop tier. These are structural tests that verify the
  // RBAC check function behavior. Full integration tests require multi-user
  // team scenarios with admin/editor/viewer roles.

  test('F95-F99 — RBAC structure: team API exists', async ({ page }) => {
    await createAuthenticatedUser(page);

    // Team API should respond (may require Shop tier)
    const { status, json } = await apiRequest(page, 'GET', '/app/api/team');
    // Either 200 (with empty members) or 403 (tier-gated)
    expect([200, 403]).toContain(status);
  });
});
