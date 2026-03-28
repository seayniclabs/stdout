import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { scannerPayloadWithDataSources } from './helpers/fixtures';

test.describe('Data Sources / Metrics Integrations (F77a-F77g)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F77a — Add Prometheus source manually', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/data-sources', {
      action: 'create',
      name: 'test_prometheus',
      type: 'prometheus',
      url: 'https://prom.example.com:9090',
    });

    expect(status).toBe(200);
    expect(json.id).toBeTruthy();
  });

  test('F77a — List data sources', async ({ page }) => {
    // Create a source first
    await apiRequest(page, 'POST', '/app/api/data-sources', {
      action: 'create',
      name: 'test_list_source',
      type: 'prometheus',
      url: 'https://prom.example.com:9090',
    });

    const { status, json } = await apiRequest(page, 'GET', '/app/api/data-sources');
    expect(status).toBe(200);
    expect(json.sources).toBeDefined();
    expect(json.sources.length).toBeGreaterThanOrEqual(1);

    // Verify tokens are masked
    for (const source of json.sources) {
      if (source.hasToken) {
        expect(source.token).toBe('********');
      }
    }
  });

  test('F77b — Test Prometheus connection (invalid endpoint)', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/data-sources', {
      action: 'test',
      type: 'prometheus',
      url: 'https://nonexistent.example.com:9090',
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toBeTruthy();
  });

  test('F77d — Scanner auto-registration of data sources', async ({ page }) => {
    // Create a token for scanner import
    const tokenResult = await apiRequest(page, 'POST', '/app/api/tokens', {
      name: 'test_ds_scanner_token',
    });
    const rawToken = tokenResult.json.token;

    // Import scan with data sources
    const response = await page.request.post('/app/api/stacks/import', {
      data: scannerPayloadWithDataSources,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawToken}`,
      },
    });

    expect(response.status()).toBe(201);
    const importJson = await response.json();
    expect(importJson.dataSourcesRegistered).toBeGreaterThan(0);
  });

  test('F77a-extra — SSRF blocked on data source URL', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/data-sources', {
      action: 'create',
      name: 'test_ssrf_ds',
      type: 'prometheus',
      url: 'http://localhost:9090',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('private or internal');
  });

  test('F77a-extra — Invalid type rejected', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/data-sources', {
      action: 'create',
      name: 'test_bad_type',
      type: 'graphite',
      url: 'https://example.com',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('Invalid type');
  });

  test('F77a-extra — Delete data source', async ({ page }) => {
    // Create
    const create = await apiRequest(page, 'POST', '/app/api/data-sources', {
      action: 'create',
      name: 'test_delete_ds',
      type: 'prometheus',
      url: 'https://prom.example.com:9090',
    });
    const dsId = create.json.id;

    // Delete
    const { status, json } = await apiRequest(page, 'POST', '/app/api/data-sources', {
      action: 'delete',
      id: dsId,
    });

    expect(status).toBe(200);
    expect(json.deleted).toBe(true);
  });
});
