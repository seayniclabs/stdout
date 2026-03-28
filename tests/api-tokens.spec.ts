import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('API Tokens (F77-F83)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F77 — Create token', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_scanner_token',
    });

    expect(status).toBe(200);
    expect(json.token).toBeTruthy();
    expect(json.token).toMatch(/^stdout_scan_/);
    expect(json.id).toBeTruthy();
    expect(json.name).toBe('test_scanner_token');
  });

  test('F78 — List tokens (no raw values)', async ({ page }) => {
    // Create a token first
    await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_list_token',
    });

    const { status, json } = await apiRequest(page, 'GET', '/app/api/tokens');
    expect(status).toBe(200);
    expect(json.tokens).toBeDefined();
    expect(json.tokens.length).toBeGreaterThanOrEqual(1);

    // Verify no raw token values or hashes are returned
    for (const token of json.tokens) {
      expect(token.name).toBeTruthy();
      expect(token.id).toBeTruthy();
      expect(token.tokenHash).toBeUndefined();
      expect(token.token).toBeUndefined();
    }
  });

  test('F79 — Use token for scanner import', async ({ page }) => {
    const createResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_import_token',
    });
    const rawToken = createResult.json.token;

    // Use the token to hit the scanner import endpoint
    const response = await page.request.post('/app/api/stacks/import', {
      data: {
        version: '1.0.0',
        containers: [
          { name: 'test_container', image: 'nginx:alpine', status: 'running', ports: [] },
        ],
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawToken}`,
      },
    });

    expect(response.status()).toBe(201);
  });

  test('F80 — Invalid token rejected', async ({ page }) => {
    const response = await page.request.post('/app/api/stacks/import', {
      data: {
        version: '1.0.0',
        containers: [{ name: 'test', image: 'test', status: 'running', ports: [] }],
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer stdout_scan_INVALID_TOKEN_VALUE',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('F81 — Revoke token then use fails', async ({ page }) => {
    // Create token
    const createResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_revoke_token',
    });
    const rawToken = createResult.json.token;
    const tokenId = createResult.json.id;

    // Revoke it
    const deleteResult = await apiRequest(page, 'DELETE', '/app/api/tokens', {
      id: tokenId,
    });
    expect(deleteResult.json.revoked).toBe(true);

    // Try to use the revoked token
    const response = await page.request.post('/app/api/stacks/import', {
      data: {
        version: '1.0.0',
        containers: [{ name: 'test', image: 'test', status: 'running', ports: [] }],
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawToken}`,
      },
    });

    expect(response.status()).toBe(401);
  });

  test('F83 — Token name required', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: '',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('Token name is required');
  });
});
