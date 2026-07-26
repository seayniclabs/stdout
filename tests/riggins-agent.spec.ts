import { test, expect } from '@playwright/test';

/**
 * Riggins Observatory Agent E2E Test
 *
 * Tests the agent chat interface end-to-end:
 * 1. Opens agent panel
 * 2. Sends test message
 * 3. Verifies response from Ollama
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://192.168.68.89:8112';

test.describe('Riggins Observatory Agent', () => {
  test.use({
    // Use existing auth state if available
    storageState: process.env.STORAGE_STATE || undefined,
  });

  test('agent panel loads and responds to queries', async ({ page }) => {
    // Navigate to dashboard
    await page.goto(`${BASE_URL}/app`);

    // Wait for page to load
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });

    // Find and click the floating agent button (bottom-right)
    const agentButton = page.locator('button[aria-label*="agent" i], button:has-text("Agent"), [data-agent-trigger]').first();

    if (await agentButton.isVisible()) {
      await agentButton.click();
    } else {
      // Try alternative selectors
      await page.locator('button').filter({ hasText: /riggins|agent/i }).first().click();
    }

    // Wait for agent panel to open
    await expect(page.locator('[data-agent-panel], aside, .agent-chat')).toBeVisible({ timeout: 5000 });

    // Find the message input
    const messageInput = page.locator('input[type="text"], textarea').filter({ hasText: '' }).first();
    await expect(messageInput).toBeVisible();

    // Type test message
    await messageInput.fill('What can you help me with?');

    // Find and click send button
    const sendButton = page.locator('button[type="submit"], button:has-text("Send")').first();
    await sendButton.click();

    // Wait for response (Ollama can be slow, especially on first run)
    const responseMessage = page.locator('[data-role="assistant"], .message-assistant, .agent-response').first();
    await expect(responseMessage).toBeVisible({ timeout: 60000 }); // 60s for Ollama response

    // Verify response contains relevant content
    const responseText = await responseMessage.textContent();
    expect(responseText).toBeTruthy();
    expect(responseText!.length).toBeGreaterThan(10);

    console.log('✅ Riggins responded:', responseText);

    // Verify response mentions infrastructure/monitoring/operations
    expect(responseText!.toLowerCase()).toMatch(/infrastructure|monitor|observ|system|service|help/);
  });

  test('agent config shows Riggins with Ollama provider', async ({ page }) => {
    // Navigate to AI settings
    await page.goto(`${BASE_URL}/app/settings/ai`);

    // Should show agent configuration
    await expect(page.locator('text=/Riggins|Agent/i')).toBeVisible({ timeout: 5000 });

    // Should show Ollama as provider
    await expect(page.locator('text=/Ollama|ollama/i')).toBeVisible({ timeout: 5000 });

    // Should show model name
    await expect(page.locator('text=/qwen2.5|14b/i')).toBeVisible({ timeout: 5000 });

    // Should show enabled status
    const enabledIndicator = page.locator('text=/enabled|active|on/i, [data-status="enabled"], input[type="checkbox"]:checked');
    await expect(enabledIndicator.first()).toBeVisible();

    console.log('✅ Agent config verified: Riggins + Ollama + qwen2.5:14b');
  });

  test('network scan command works via agent', async ({ page }) => {
    await page.goto(`${BASE_URL}/app`);

    // Open agent panel
    const agentButton = page.locator('button[aria-label*="agent" i], button:has-text("Agent")').first();
    await agentButton.click();

    await expect(page.locator('[data-agent-panel], aside, .agent-chat')).toBeVisible();

    // Send network scan command
    const messageInput = page.locator('input[type="text"], textarea').filter({ hasText: '' }).first();
    await messageInput.fill('scan my network');

    const sendButton = page.locator('button[type="submit"], button:has-text("Send")').first();
    await sendButton.click();

    // Wait for scan to complete (can take 10-15s)
    const responseMessage = page.locator('[data-role="assistant"], .message-assistant').first();
    await expect(responseMessage).toBeVisible({ timeout: 30000 });

    const responseText = await responseMessage.textContent();
    console.log('✅ Network scan response:', responseText);

    // Should mention devices found or scanning
    expect(responseText!.toLowerCase()).toMatch(/scan|device|network|found|discover/);
  });
});
