import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testMonitorHTTP, testMonitorTCP } from './helpers/fixtures';

test.describe('HUD Monitors (F55-F68)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F55 — Create HTTP monitor', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorHTTP,
    });

    expect(status).toBe(201);
    expect(json.id).toBeTruthy();
    expect(json.name).toBe(testMonitorHTTP.name);
  });

  test('F56 — Create TCP monitor', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorTCP,
    });

    expect(status).toBe(201);
    expect(json.id).toBeTruthy();
    expect(json.name).toBe(testMonitorTCP.name);
  });

  test('F57 — List monitors with status', async ({ page }) => {
    // Create a monitor first
    await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorHTTP,
    });

    const { status, json } = await apiRequest(page, 'GET', '/app/api/monitors');
    expect(status).toBe(200);
    expect(json.monitors).toBeDefined();
    expect(json.monitors.length).toBeGreaterThanOrEqual(1);
  });

  test('F64 — Pause monitor', async ({ page }) => {
    // Create a monitor
    const createResult = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorHTTP,
    });
    const monitorId = createResult.json.id;

    // Pause it
    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'update',
      id: monitorId,
      paused: true,
    });

    expect(status).toBe(200);
    expect(json.updated).toBe(true);
  });

  test('F65 — Maintenance mode', async ({ page }) => {
    // Create a monitor
    const createResult = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorHTTP,
    });
    const monitorId = createResult.json.id;

    // Enable maintenance
    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'update',
      id: monitorId,
      maintenance: true,
    });

    expect(status).toBe(200);
    expect(json.updated).toBe(true);

    // Verify status is maintenance
    const detail = await apiRequest(page, 'GET', `/app/api/monitors?id=${monitorId}`);
    expect(detail.json.monitor.currentStatus).toBe('maintenance');
  });

  test('F66 — Monitor detail page renders', async ({ page }) => {
    // Create a monitor
    const createResult = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorHTTP,
    });
    const monitorId = createResult.json.id;

    await page.goto(`/app/hud/${monitorId}`);
    // Page should render (not 404 or error)
    const body = await page.textContent('body');
    expect(body).toContain(testMonitorHTTP.name);
  });

  test('F67 — Monitor map page renders', async ({ page }) => {
    await page.goto('/app/hud/map');
    const response = await page.goto('/app/hud/map');
    expect(response?.status()).toBeLessThan(400);
  });

  test('F68 — Monitor detail API returns uptime stats', async ({ page }) => {
    // Create a monitor
    const createResult = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorHTTP,
    });
    const monitorId = createResult.json.id;

    const { status, json } = await apiRequest(page, 'GET', `/app/api/monitors?id=${monitorId}`);
    expect(status).toBe(200);
    expect(json.monitor).toBeDefined();
    expect(json.uptime).toBeDefined();
  });

  test('F55-extra — Delete monitor', async ({ page }) => {
    // Create and then delete
    const createResult = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      ...testMonitorHTTP,
    });
    const monitorId = createResult.json.id;

    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'delete',
      id: monitorId,
    });

    expect(status).toBe(200);
    expect(json.deleted).toBe(true);
  });

  test('F55-extra — Create monitor missing fields returns 400', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      name: '',
      type: '',
      target: '',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('required');
  });

  test('F55-extra — Invalid monitor type returns 400', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/monitors', {
      action: 'create',
      name: 'test_bad_type',
      type: 'invalid',
      target: 'https://example.com',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('http or tcp');
  });
});
