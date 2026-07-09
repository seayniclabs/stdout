import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

const sampleAlert = (overrides: Record<string, unknown> = {}) => ({
  timestamp: '2026-07-03T12:00:00.000000+0000',
  event_type: 'alert',
  src_ip: '203.0.113.50',
  src_port: 54321,
  dest_ip: '192.168.1.10',
  dest_port: 22,
  proto: 'TCP',
  alert: {
    action: 'allowed',
    gid: 1,
    signature_id: 2001219,
    rev: 1,
    signature: 'ET SCAN Potential SSH Scan',
    category: 'Attempted Information Leak',
    severity: 1,
  },
  ...overrides,
});

test.describe('Suricata EVE webhook (TOOL1)', () => {
  test('SC1 — rejects unauthenticated requests', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonResp = await anon.request.post('/app/api/suricata/webhook', {
      data: sampleAlert(),
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(anonResp.status());
    await anon.close();
  });

  test('SC2 — dryRun classifies high-severity alert as ip_block', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(
      page,
      'POST',
      '/app/api/suricata/webhook?dryRun=1&resetCorrelation=1',
      sampleAlert(),
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.alerts[0].kind).toBe('ip_block');
    expect(json.alerts[0].severity).toBe('critical');
    expect(json.alerts[0].srcIp).toBe('203.0.113.50');
    expect(json.alerts[0].signature).toContain('SSH Scan');
  });

  test('SC3 — dryRun correlates repeated alerts from same IP', async ({ page }) => {
    await createAuthenticatedUser(page);
    // Reset then send threshold-1 medium alerts; last should be correlated.
    await apiRequest(page, 'POST', '/app/api/suricata/webhook?dryRun=1&resetCorrelation=1', sampleAlert({
      alert: {
        action: 'allowed',
        gid: 1,
        signature_id: 1,
        signature: 'ET POLICY Example 1',
        category: 'Misc',
        severity: 2,
      },
    }));

    for (let i = 2; i <= 3; i++) {
      const { status, json } = await apiRequest(
        page,
        'POST',
        '/app/api/suricata/webhook?dryRun=1',
        sampleAlert({
          alert: {
            action: 'allowed',
            gid: 1,
            signature_id: i,
            signature: `ET POLICY Example ${i}`,
            category: 'Misc',
            severity: 2,
          },
        }),
      );
      expect(status).toBe(200);
      if (i === 3) {
        expect(json.alerts[0].correlated).toBe(true);
        expect(json.alerts[0].kind).toBe('ip_block');
        expect(json.alerts[0].alertCount).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('SC4 — bearer token ingests alert and creates incident', async ({ page }) => {
    await createAuthenticatedUser(page);

    const createResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'suricata_webhook_token',
    });
    const rawToken = createResult.json.token;
    expect(rawToken).toMatch(/^stdout_scan_/);

    const response = await page.request.post('/app/api/suricata/webhook?autoFix=0&resetCorrelation=1', {
      data: sampleAlert(),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawToken}`,
      },
    });

    expect(response.status()).toBe(201);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.alert.kind).toBe('ip_block');
    expect(json.incidentId).toBeTruthy();
    expect(json.fix.attempted).toBe(false);
  });

  test('SC5 — skips non-alert EVE events', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/suricata/webhook?autoFix=0', {
      timestamp: '2026-07-03T12:00:00.000000+0000',
      event_type: 'flow',
      src_ip: '203.0.113.50',
      dest_ip: '192.168.1.10',
    });
    expect(status).toBe(200);
    expect(json.skipped).toBe(true);
    expect(json.incidentId).toBeNull();
  });

  test('SC6 — settings page shows Suricata webhook URL', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/settings');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-tab="integrations"]').click();
    await expect(page.locator('#suricataWebhookUrl')).toBeVisible();
    const url = await page.locator('#suricataWebhookUrl').inputValue();
    expect(url).toContain('/app/api/suricata/webhook');
  });
});
