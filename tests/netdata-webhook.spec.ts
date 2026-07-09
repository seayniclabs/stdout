import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('Netdata Cloud webhook (QW6)', () => {
  test('ND1 — rejects unauthenticated requests', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonResp = await anon.request.post('/app/api/netdata/webhook', {
      data: { message: 'test', severity: 'warning', alert: 'ram.available' },
      headers: { 'Content-Type': 'application/json' },
    });
    // 401 (no user) or 403 (CSRF/origin) — either means the webhook is not open
    expect([401, 403]).toContain(anonResp.status());
    await anon.close();
  });

  test('ND2 — dryRun classifies memory alert', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/netdata/webhook?dryRun=1', {
      message: 'ram.available is critically low',
      alert: 'ram_available',
      info: 'free memory below threshold',
      chart: 'system.ram',
      context: 'system.ram',
      family: 'mem',
      severity: 'critical',
      alert_url: 'https://app.netdata.cloud/alerts/1',
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.anomaly.kind).toBe('memory');
    expect(json.anomaly.severity).toBe('critical');
  });

  test('ND3 — dryRun classifies reachability', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/netdata/webhook?dryRun=1', {
      message: 'Host is unreachable',
      host: 'edge-01',
      severity: 'critical',
      status: { reachable: false, text: 'unreachable' },
      url: 'https://app.netdata.cloud/nodes/edge-01',
    });
    expect(status).toBe(200);
    expect(json.anomaly.kind).toBe('host_unreachable');
    expect(json.anomaly.severity).toBe('critical');
  });

  test('ND4 — bearer token ingests alert and creates incident', async ({ page }) => {
    await createAuthenticatedUser(page);

    const createResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'netdata_webhook_token',
    });
    const rawToken = createResult.json.token;
    expect(rawToken).toMatch(/^stdout_scan_/);

    const response = await page.request.post('/app/api/netdata/webhook?autoFix=0', {
      data: {
        message: 'disk.space is critically low on /',
        alert: 'disk_space_usage',
        chart: 'disk_space._',
        context: 'disk.space',
        family: 'disk',
        severity: 'critical',
        alert_url: 'https://app.netdata.cloud/alerts/2',
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawToken}`,
      },
    });

    expect(response.status()).toBe(201);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.anomaly.kind).toBe('disk');
    expect(json.incidentId).toBeTruthy();
    expect(json.fix.attempted).toBe(false);
  });

  test('ND5 — settings page shows Netdata webhook URL', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/settings');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-tab="integrations"]').click();
    await expect(page.locator('#netdataWebhookUrl')).toBeVisible();
    const url = await page.locator('#netdataWebhookUrl').inputValue();
    expect(url).toContain('/app/api/netdata/webhook');
  });
});
