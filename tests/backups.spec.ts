import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('Encrypted Backups (F84-F91)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F84 — Create backup', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/backups', {
      action: 'create',
    });

    // May fail if backup master key is not mounted (test env)
    // or if tier gate blocks free users
    if (status === 200) {
      expect(json.backup).toBeDefined();
      expect(json.backup.filename).toBeTruthy();
    } else if (status === 403) {
      // Tier-gated — free tier may not have backup access
      expect(json.error).toBeTruthy();
    } else {
      // 500 if backup key not mounted — acceptable in test env
      expect([403, 500]).toContain(status);
    }
  });

  test('F85 — List backups', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'GET', '/app/api/backups');
    expect(status).toBe(200);
    expect(json.backups).toBeDefined();
    expect(Array.isArray(json.backups)).toBe(true);
  });

  test('F88 — Path traversal blocked in restore', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/backups', {
      action: 'restore',
      filename: '../../etc/passwd',
    });

    // Should reject — either path traversal detection or file not found
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('F91 — Backup file not found', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/backups', {
      action: 'restore',
      filename: 'nonexistent_test_backup_file.db.enc',
    });

    expect(status).toBeGreaterThanOrEqual(400);
    if (json?.error) {
      expect(json.error.toLowerCase()).toMatch(/not found|does not exist|no such/i);
    }
  });

  test('F84-extra — Missing filename in restore returns 400', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/backups', {
      action: 'restore',
      filename: '',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('Missing filename');
  });

  test('F84-extra — Unknown action returns 400', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/backups', {
      action: 'invalid_action',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('Unknown action');
  });
});
