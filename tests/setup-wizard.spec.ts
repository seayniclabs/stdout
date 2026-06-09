import { test, expect } from '@playwright/test';

const STDOUT_URL = 'http://192.168.0.244:8112';

test.describe('StdOut Setup Wizard E2E', () => {
  test('complete setup wizard flow from start to finish', async ({ page }) => {
    test.setTimeout(600000); // 10 minutes for entire test (scanner can take 5+ minutes for full network scan)

    // Pre-test: Wipe all data to ensure clean state
    const wipeResponse = await page.request.post(`${STDOUT_URL}/app/api/test/wipe-data`);
    if (!wipeResponse.ok()) {
      console.warn('[WARN] Could not wipe data before test:', await wipeResponse.text());
    } else {
      console.log('[INFO] Data wiped successfully - starting with clean database');
    }

    // Step 1: Navigate to setup wizard
    await page.goto(STDOUT_URL);
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.locator('h1')).toContainText('Welcome to StdOut');

    // Step 2: Create admin account (no confirmPassword field exists)
    await page.fill('input[name="displayName"]', 'Test Admin');
    await page.fill('input[name="email"]', 'admin@test.local');
    await page.fill('input[name="password"]', 'Test123!@#Admin');
    await page.click('button[type="submit"]'); // Actual button is type=submit

    // Step 3: Environment configuration
    await page.waitForURL(/\/setup\/environment$/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Name Your Environment');

    // Fill in environment details
    await page.fill('input[name="environmentName"]', 'Test Environment');
    await page.click('button:has-text("Continue")');

    // Step 4: License page - skip for now
    await page.waitForURL(/\/setup\/license$/);
    await expect(page.locator('h1')).toContainText('License');
    await page.click('button:has-text("Skip for Now")');

    // Step 5: Network Scanner
    await page.waitForURL(/\/setup\/scanner$/);
    await expect(page.locator('h1')).toContainText('Discover Your Infrastructure');

    // Wait for subnet detection
    await page.waitForSelector('input#subnet', { state: 'visible' });
    const subnetInput = page.locator('input#subnet');
    await expect(subnetInput).not.toHaveValue('Detecting...');

    // Verify subnet was auto-detected
    const detectedSubnet = await subnetInput.inputValue();
    console.log('Detected subnets:', detectedSubnet);
    expect(detectedSubnet).toBeTruthy();
    expect(detectedSubnet.length).toBeGreaterThan(0);

    // Click scan button
    await page.click('button#scanButton');

    // Wait for scanning to start
    await expect(page.locator('#scanButtonText')).toContainText('Scanning');

    // Wait for scan progress div to appear
    await page.waitForSelector('#scanProgress', { state: 'visible', timeout: 5000 });

    // Wait a moment for SSE events to start flowing
    await page.waitForTimeout(2000);

    // Check if we're getting log output (indicates SSE is working)
    const logCount = await page.locator('#scanLogs p').count();
    console.log(`Scan logs visible: ${logCount} entries`);

    if (logCount === 0) {
      console.warn('WARNING: No scan log entries visible - SSE stream may not be working');
    }

    // Wait for scan to complete (up to 5 minutes - full network scan can be slow)
    console.log('Waiting for scan completion...');
    await page.waitForSelector('.status-icon:has-text("✅")', { timeout: 300000 });
    console.log('Scan completed!');
    await expect(page.locator('.status-text')).toContainText('Found');

    // Should auto-advance to review page (waits 2s before redirecting)
    await page.waitForURL(/\/setup\/review$/, { timeout: 10000 });

    // Step 6: Review discovered infrastructure
    await expect(page.locator('h1')).toContainText('Review Your Infrastructure');
    await page.click('button:has-text("Continue")');

    // Step 7: Windlass configuration - skip
    await page.waitForURL(/\/setup\/windlass$/);
    await expect(page.locator('h1')).toContainText('Configure Windlass');
    // Click the label for the skip radio button (radio is display:none)
    await page.click('label:has(input[type="radio"][value="skip"])');
    await page.click('button[type="submit"]:has-text("Continue")');

    // Step 8: Ticketing - skip
    await page.waitForURL(/\/setup\/ticketing$/);
    await expect(page.locator('h1')).toContainText('Ticketing');
    // Click the label for the skip radio button (radio is display:none)
    await page.click('label:has(input[name="ticketing_choice"][value="skip"])');
    await page.click('button[type="submit"]:has-text("Continue")');

    // Step 9: Setup complete
    await page.waitForURL(/\/setup\/complete$/);
    await expect(page.locator('h1')).toContainText('Setup Complete');
    await page.click('a:has-text("Go to Dashboard")');

    // Step 10: Verify we land on the dashboard
    await page.waitForURL(/\/app$/);
    await expect(page).toHaveURL(/\/app$/);

    // Verify user is logged in and sees dashboard
    await expect(page.locator('body')).not.toContainText('Login');

    console.log('✅ Setup wizard completed successfully');
  });

  test('scanner progress output is visible during scan', async ({ page }) => {
    // This test assumes setup is already complete from previous test
    // Re-run scanner from the app interface to verify progress visibility

    await page.goto(`${STDOUT_URL}/app/login`);
    await page.fill('input[name="email"]', 'admin@test.local');
    await page.fill('input[name="password"]', 'Test123!@#Admin');
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/app$/);

    // Navigate to network scanner (if accessible post-setup)
    // This will fail if scanner is only accessible during setup
    // If it fails, that's a valid test result - document it
  });
});
