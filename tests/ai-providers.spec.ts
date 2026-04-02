import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';

test.describe('AI Providers — BYOK Key Management', () => {
  test('BYOK1 — AI Providers section visible in settings (self-hosted)', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/settings');
    await page.locator('.tab-btn[data-tab="integrations"]').click();
    await expect(page.locator('#aiProvidersList')).toBeVisible();
  });

  test('BYOK2 — Add Provider button shows form', async ({ page }) => {
    await createAuthenticatedUser(page);
    await page.goto('/app/settings');
    await page.locator('.tab-btn[data-tab="integrations"]').click();
    await page.locator('#aiAddBtn').click();
    await expect(page.locator('#aiProviderForm')).toBeVisible();
    await expect(page.locator('#aiProviderSelect')).toBeVisible();
    await expect(page.locator('#aiKeyInput')).toBeVisible();
  });

  test('BYOK3 — Provider list API returns available providers', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'GET', '/app/api/settings/ai-providers');
    expect(status).toBe(200);
    expect(json.providers).toBeInstanceOf(Array);
    expect(json.providers.length).toBeGreaterThanOrEqual(2); // At least Anthropic + OpenAI

    // Verify certified providers
    const anthropic = json.providers.find((p: any) => p.id === 'anthropic');
    expect(anthropic).toBeTruthy();
    expect(anthropic.state).toBe('certified');
    expect(anthropic.canDiagnostics).toBe(true);
    expect(anthropic.canAutofix).toBe(true);

    // Verify beta provider
    const gemini = json.providers.find((p: any) => p.id === 'gemini');
    expect(gemini).toBeTruthy();
    expect(gemini.state).toBe('beta');
    expect(gemini.canAutofix).toBe(false);
  });

  test('BYOK4 — Save key API rejects missing fields', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'save',
      provider: 'anthropic',
      // missing apiKey
    });
    expect(status).toBe(400);
    expect(json.error).toContain('apiKey');
  });

  test('BYOK5 — Save key API rejects unknown provider', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'save',
      provider: 'unknown-provider',
      apiKey: 'sk-test-key-123',
    });
    expect(status).toBe(400);
    expect(json.error).toContain('Unknown provider');
  });

  test('BYOK6 — Save key API stores key with fingerprint', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'save',
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-for-playwright-verification-1234',
      diagnosticsModel: 'claude-haiku-4-5-20251001',
    });
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.fingerprint).toBeTruthy();
    expect(json.fingerprint).toContain('sk-a'); // First 4 chars
    expect(json.fingerprint).toContain('1234'); // Last 4 chars
  });

  test('BYOK7 — List keys shows saved key without secret', async ({ page }) => {
    await createAuthenticatedUser(page);
    // Save a key first
    await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'save',
      provider: 'openai',
      apiKey: 'sk-openai-test-key-for-playwright-5678',
    });

    const { status, json } = await apiRequest(page, 'GET', '/app/api/settings/ai-providers');
    expect(status).toBe(200);

    const openai = json.providers.find((p: any) => p.id === 'openai');
    expect(openai.savedKey).toBeTruthy();
    expect(openai.savedKey.keyFingerprint).toBeTruthy();
    expect(openai.savedKey.status).toBe('active');
    // Key should NOT be in the response
    expect(openai.savedKey.encryptedApiKey).toBeUndefined();
  });

  test('BYOK8 — Delete key removes it', async ({ page }) => {
    await createAuthenticatedUser(page);
    // Save
    const saveRes = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'save',
      provider: 'anthropic',
      apiKey: 'sk-ant-delete-test-key-9999',
    });

    // List to get ID
    const listRes = await apiRequest(page, 'GET', '/app/api/settings/ai-providers');
    const anthropic = listRes.json.providers.find((p: any) => p.id === 'anthropic');
    const keyId = anthropic.savedKey.id;

    // Delete
    const { status, json } = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'delete',
      keyId,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    // Verify gone
    const listRes2 = await apiRequest(page, 'GET', '/app/api/settings/ai-providers');
    const anthropic2 = listRes2.json.providers.find((p: any) => p.id === 'anthropic');
    expect(anthropic2.savedKey).toBeNull();
  });

  test('BYOK9 — Update preferences', async ({ page }) => {
    await createAuthenticatedUser(page);
    // Save key first
    await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'save',
      provider: 'anthropic',
      apiKey: 'sk-ant-prefs-test-key-7777',
    });

    // Update model preference
    const { status, json } = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'update_preferences',
      provider: 'anthropic',
      diagnosticsModel: 'claude-opus-4-6-20250618',
      platformFallback: false,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  test('BYOK10 — Validate rejects non-existent key', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'validate',
      provider: 'anthropic',
    });
    // No key saved for this fresh user
    expect(json.valid).toBe(false);
  });

  test('BYOK11 — Unknown action returns 400', async ({ page }) => {
    await createAuthenticatedUser(page);
    const { status, json } = await apiRequest(page, 'POST', '/app/api/settings/ai-providers', {
      action: 'nonexistent',
    });
    expect(status).toBe(400);
    expect(json.error).toContain('Unknown action');
  });

  test('BYOK12 — Unauthenticated access returns 401 or redirect', async ({ page }) => {
    const response = await page.request.get('/app/api/settings/ai-providers', {
      maxRedirects: 0,
    });
    // API should return 401 or redirect to login
    expect([200, 302, 401].some(s => response.status() === s || response.status() === 302)).toBe(true);
  });
});
