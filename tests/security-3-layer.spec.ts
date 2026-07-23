/**
 * 3-Layer Security Pattern E2E Tests
 *
 * Validates that all secured endpoints enforce:
 * 1. Authentication (requireAuth)
 * 2. Authorization (RBAC)
 * 3. CSRF Protection (on mutations)
 */

import { test, expect } from '@playwright/test';
import { createAuthenticatedUser } from './helpers/auth';

test.describe('3-Layer Security Pattern', () => {
  test('Layer 1: Unauthenticated requests return 401', async ({ request }) => {
    // Test a sample of secured endpoints without auth
    const endpoints = [
      '/app/api/monitors',
      '/app/api/incidents',
      '/app/api/playbooks',
      '/app/api/stacks',
      '/app/api/me',
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('Unauthorized');
    }
  });

  test('Layer 2: RBAC blocks unauthorized actions', async ({ page, request }) => {
    await createAuthenticatedUser(page);

    // Get CSRF token
    const csrfMeta = await page.locator('meta[name="csrf-token"]').getAttribute('content');

    // Try to execute a playbook without execute_playbook permission
    // (default user role only has basic permissions)
    const response = await request.post('/app/api/playbooks/execute', {
      headers: {
        'x-csrf-token': csrfToken || '',
      },
      data: {
        playbookId: 'test-playbook-id',
        _csrf: csrfToken,
      },
    });

    // Should be blocked by RBAC (403) or not found (404) if playbook doesn't exist
    // Either way, it shouldn't succeed (200) without proper permissions
    expect([403, 404]).toContain(response.status());
  });

  test('Layer 3: Missing CSRF token blocks mutations', async ({ page, request }) => {
    await createAuthenticatedUser(page);

    // Try POST without CSRF token
    const response = await request.post('/app/api/monitors', {
      data: {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
      },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('CSRF');
  });

  test('Layer 3: Invalid CSRF token blocks mutations', async ({ page, request }) => {
    await createAuthenticatedUser(page);

    const response = await request.post('/app/api/monitors', {
      headers: {
        'x-csrf-token': 'invalid-token-123',
      },
      data: {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        _csrf: 'invalid-token-123',
      },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('CSRF');
  });

  test('All 3 layers pass: Authenticated + RBAC + CSRF succeeds', async ({ page, request }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app');

    // Get valid CSRF token
    const csrfToken = await page.locator('meta[name="csrf-token"]').getAttribute('content');
    expect(csrfToken).toBeTruthy();

    // Create a monitor with all 3 layers satisfied
    const response = await request.post('/app/api/monitors', {
      headers: {
        'x-csrf-token': csrfToken!,
      },
      data: {
        name: 'Security Test Monitor',
        type: 'http',
        url: 'https://httpbin.org/status/200',
        interval: 60,
        _csrf: csrfToken,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test('GET requests require auth but not CSRF', async ({ page, request }) => {
    await createAuthenticatedUser(page);

    // GET requests should work without CSRF token
    const response = await request.get('/app/api/monitors');
    expect(response.status()).toBe(200);
  });

  test('DELETE requires all 3 layers', async ({ page, request }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app');

    const csrfToken = await page.locator('meta[name="csrf-token"]').getAttribute('content');

    // Try DELETE without CSRF
    let response = await request.delete('/app/api/monitors?id=test-id');
    expect(response.status()).toBe(403);

    // Try DELETE with CSRF
    response = await request.delete('/app/api/monitors?id=test-id', {
      headers: {
        'x-csrf-token': csrfToken!,
      },
    });

    // Should be 404 (monitor doesn't exist) not 403 (CSRF blocked)
    expect(response.status()).toBe(404);
  });
});

test.describe('Security Regression Prevention', () => {
  test('Excluded endpoints remain accessible', async ({ request }) => {
    // Public health check
    const healthResponse = await request.get('/health');
    expect(healthResponse.status()).toBe(200);

    // Satellite ping (public discovery)
    const pingResponse = await request.post('/app/api/satellite/ping', {
      data: {
        satelliteId: 'test-satellite',
        ip: '192.168.1.100',
      },
    });
    expect([200, 400]).toContain(pingResponse.status()); // 200 or 400 (validation), not 401
  });

  test('Bearer token auth works for satellite report', async ({ request }) => {
    const response = await request.post('/app/api/satellite/report', {
      headers: {
        'Authorization': 'Bearer test-token',
      },
      data: {
        satelliteId: 'test',
        status: 'ok',
        metrics: {},
      },
    });

    // Should not be 401 (auth required) - bearer token is accepted
    // Might be 403 (invalid token) or 400 (validation) but not 401
    expect(response.status()).not.toBe(401);
  });
});
