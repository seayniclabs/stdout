import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

const SAMPLE_STREAMS = {
  streams: [
    {
      stream: { job: 'stdout', service: 'gateway' },
      values: [
        ['1710000000000000000', 'ERROR connection refused to db'],
        ['1710000001000000000', 'ERROR timeout waiting for upstream'],
        ['1710000002000000000', 'FATAL panic: nil pointer'],
        ['1710000003000000000', 'WARN retrying request'],
        ['1710000004000000000', 'info: request completed'],
      ],
    },
    {
      stream: { job: 'stdout', service: 'jobs' },
      values: [
        ['1710000005000000000', 'ERROR job failed: OOM'],
        ['1710000006000000000', 'CRITICAL out of memory'],
        ['1710000007000000000', 'FATAL cannot allocate'],
      ],
    },
  ],
};

test.describe('Loki LogQL ingest (TOOL5)', () => {
  test('LK1 — rejects unauthenticated requests', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonResp = await anon.request.post('/app/api/loki/ingest', {
      data: SAMPLE_STREAMS,
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(anonResp.status());
    await anon.close();
  });

  test('LK2 — dryRun parses streams and aggregates metrics', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/loki/ingest?dryRun=1', SAMPLE_STREAMS);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.entriesFetched).toBe(8);
    expect(json.metrics.loki_log_total).toBe(8);
    expect(json.metrics.loki_error_count).toBeGreaterThanOrEqual(5);
    expect(json.metrics.loki_critical_count).toBeGreaterThanOrEqual(3);
    expect(json.metrics.loki_warn_count).toBe(1);
    expect(json.metrics.loki_stream_count).toBe(2);
    expect(json.errorGroups.length).toBeGreaterThanOrEqual(2);
    expect(json.sampleLines.length).toBeGreaterThan(0);
  });

  test('LK3 — pre-normalized logs body shape', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/loki/ingest?dryRun=1', {
      logs: [
        { message: 'ERROR boom', labels: { job: 'stdout' } },
        { message: 'FATAL crash', labels: { job: 'stdout' } },
      ],
      query: '{job="stdout"} |= "error"',
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.query).toBe('{job="stdout"} |= "error"');
    expect(json.entriesFetched).toBe(2);
    expect(json.metrics.loki_error_count).toBe(2);
    expect(json.metrics.loki_critical_count).toBe(1);
  });

  test('LK4 — ingest updates baselines and opens critical-burst incidents', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/loki/ingest', SAMPLE_STREAMS);
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.entriesFetched).toBe(8);
    expect(json.baselinesUpdated).toBeGreaterThan(0);
    // jobs service has 3 critical lines → incident without baseline history
    expect(json.incidentIds.length).toBeGreaterThanOrEqual(1);
    expect(json.errorGroups.some((g: { service: string; critical: number }) =>
      g.service === 'jobs' && g.critical >= 3,
    )).toBe(true);
  });

  test('LK5 — noIncidents updates baselines only', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(
      page,
      'POST',
      '/app/api/loki/ingest?noIncidents=1',
      SAMPLE_STREAMS,
    );
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.baselinesUpdated).toBeGreaterThan(0);
    expect(json.incidentIds).toEqual([]);
  });

  test('LK6 — GET status reports configuration', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'GET', '/app/api/loki/ingest');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.configured).toBe('boolean');
    expect(typeof json.healthy).toBe('boolean');
    expect(json.schedule?.intervalMinutes).toBe(5);
    expect(json.schedule?.labels?.job).toBe('stdout');
    expect(json.usage).toBeTruthy();
  });

  test('LK7 — live query without Loki source returns 400', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/loki/ingest', {
      query: '{job="stdout"} |= "error"',
      minutes: 5,
    });
    // No LOKI_URL / data source in test env → 400
    expect([400, 502]).toContain(status);
    expect(json.error).toBeTruthy();
  });
});
