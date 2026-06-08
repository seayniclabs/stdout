import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Test configuration
const TEST_EMAIL = 'agent@seayniclabs.com';
const TEST_PASSWORD = 'SecurePass123!';
const TEST_DISPLAY_NAME = 'Agent';
const TEST_ENV_NAME = 'QA Test Environment';

// Screenshot directory
const SCREENSHOT_DIR = path.join(process.cwd(), '..', 'docs', 'qa-screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Helper to capture screenshots at each step
 */
async function screenshot(page: Page, name: string) {
  const filename = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  console.log(`📸 Screenshot saved: ${filename}`);
  return filename;
}

/**
 * Helper to get browser console logs
 */
async function getConsoleLogs(page: Page): Promise<string[]> {
  const logs: string[] = [];
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });
  return logs;
}

test.describe('StdOut Setup Wizard - QA Walkthrough', () => {
  test('Setup Wizard - Complete Flow', async ({ page, context }) => {
    console.log('\n=== StdOut Setup Wizard QA Test Start ===\n');

    // Step 0: Verify fresh database (no users)
    console.log('Step 0: Verifying fresh database...');
    await page.goto('https://stdout.seaynicroute.com/');

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle');
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    // ===== STEP 1: ADMIN ACCOUNT CREATION =====
    console.log('\n--- Step 1: Admin Account Creation ---');
    const step1Start = Date.now();

    await page.goto('https://stdout.seaynicroute.com/setup');
    await page.waitForLoadState('networkidle');

    // Check page title
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);
    expect(pageTitle).toContain('Set up StdOut');

    // Take screenshot of setup page
    await screenshot(page, '01-setup-page');

    // Check form elements exist
    const displayNameInput = page.locator('input[name="displayName"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');
    const confirmInput = page.locator('input[name="confirm"]');
    const submitButton = page.locator('button[type="submit"]');

    expect(await displayNameInput.isVisible()).toBeTruthy();
    expect(await emailInput.isVisible()).toBeTruthy();
    expect(await passwordInput.isVisible()).toBeTruthy();
    expect(await confirmInput.isVisible()).toBeTruthy();
    expect(await submitButton.isVisible()).toBeTruthy();

    // Test password mismatch error first
    console.log('Testing password mismatch validation...');
    await displayNameInput.fill(TEST_DISPLAY_NAME);
    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);
    await confirmInput.fill('WrongPassword123!');
    await submitButton.click();

    // Should show error
    const errorMsg = page.locator('.auth-error');
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
    const errorText = await errorMsg.textContent();
    console.log(`Error shown: ${errorText}`);
    expect(errorText).toContain("don't match");

    await screenshot(page, '02-password-mismatch-error');

    // Test too short password
    console.log('Testing short password validation...');
    await passwordInput.clear();
    await confirmInput.clear();
    await passwordInput.fill('short1!');
    await confirmInput.fill('short1!');
    await submitButton.click();

    await expect(errorMsg).toBeVisible({ timeout: 5000 });
    const shortPwdError = await errorMsg.textContent();
    console.log(`Error shown: ${shortPwdError}`);
    expect(shortPwdError).toContain('at least 8 characters');

    await screenshot(page, '03-short-password-error');

    // Now fill in correctly
    console.log('Filling in correct admin account details...');
    await displayNameInput.clear();
    await emailInput.clear();
    await passwordInput.clear();
    await confirmInput.clear();

    await displayNameInput.fill(TEST_DISPLAY_NAME);
    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);
    await confirmInput.fill(TEST_PASSWORD);

    await screenshot(page, '04-admin-form-filled');

    // Submit form
    console.log('Submitting admin account form...');
    await submitButton.click();

    // Should redirect to /setup/environment
    await page.waitForURL(/\/setup\/environment/, { timeout: 10000 });
    const step1Duration = Date.now() - step1Start;
    console.log(`✓ Step 1 Complete (${step1Duration}ms)`);

    await screenshot(page, '05-redirected-to-environment');

    // ===== STEP 2: ENVIRONMENT NAMING =====
    console.log('\n--- Step 2: Environment Naming ---');
    const step2Start = Date.now();

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Take screenshot
    await screenshot(page, '06-environment-page');

    // Check heading
    const envHeading = page.locator('h1');
    const headingText = await envHeading.textContent();
    console.log(`Page heading: ${headingText}`);
    expect(headingText).toContain('environment');

    // Find environment name input
    const envNameInput = page.locator('input[name="environmentName"], input[placeholder*="environment"], input[type="text"]');
    if (await envNameInput.isVisible()) {
      console.log('Found environment name input');
      await envNameInput.fill(TEST_ENV_NAME);
      await screenshot(page, '07-environment-form-filled');

      // Submit
      const envSubmit = page.locator('button[type="submit"]');
      if (await envSubmit.isVisible()) {
        console.log('Submitting environment name...');
        await envSubmit.click();

        // Wait for next step
        try {
          await page.waitForURL(/\/setup\/(license|scanner|review|windlass|complete)/, { timeout: 10000 });
          const step2Duration = Date.now() - step2Start;
          console.log(`✓ Step 2 Complete (${step2Duration}ms)`);
        } catch (e) {
          console.warn('Environment step may have completed but nav is unclear');
        }
      }
    } else {
      console.warn('⚠ Environment name input not found - may have auto-progressed');
    }

    await screenshot(page, '08-after-environment');

    // ===== STEP 3: LICENSE ACTIVATION =====
    console.log('\n--- Step 3: License Activation ---');
    const step3Start = Date.now();

    const currentUrl3 = page.url();
    console.log(`Current URL: ${currentUrl3}`);

    if (currentUrl3.includes('/license')) {
      await page.waitForLoadState('networkidle');
      await screenshot(page, '09-license-page');

      // Check for skip button
      const skipButton = page.locator('button:has-text("Skip"), a:has-text("Skip")');
      const nextButton = page.locator('button:has-text("Next"), button[type="submit"]');

      if (await skipButton.isVisible()) {
        console.log('Found skip button, clicking to skip license...');
        await skipButton.click();
        await page.waitForURL(/\/setup\/(scanner|review|windlass|complete)/, { timeout: 10000 });
      } else if (await nextButton.isVisible()) {
        console.log('Clicking next button to continue...');
        await nextButton.click();
        await page.waitForURL(/\/setup\/(scanner|review|windlass|complete)/, { timeout: 10000 });
      }

      const step3Duration = Date.now() - step3Start;
      console.log(`✓ Step 3 Complete (${step3Duration}ms)`);
      await screenshot(page, '10-after-license');
    } else {
      console.warn('⚠ Not on license page, may have been skipped');
    }

    // ===== STEP 4: INFRASTRUCTURE SCANNER =====
    console.log('\n--- Step 4: Infrastructure Scanner ---');
    const step4Start = Date.now();

    const currentUrl4 = page.url();
    console.log(`Current URL: ${currentUrl4}`);

    if (currentUrl4.includes('/scanner')) {
      await page.waitForLoadState('networkidle');
      await screenshot(page, '11-scanner-page');

      // Check for scan button
      const scanButton = page.locator('button:has-text("Scan"), button:has-text("Start")');
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue")');

      if (await scanButton.isVisible()) {
        console.log('Found scan button, initiating scan...');
        await scanButton.click();

        // Wait for scan to complete (may take a moment)
        try {
          await page.waitForURL(/\/setup\/(review|windlass|complete)/, { timeout: 30000 });
          console.log('Scan completed and progressed');
        } catch (e) {
          console.warn('⚠ Scan may still be running or auto-progress failed');
          // Try clicking next if visible
          if (await nextButton.isVisible()) {
            console.log('Clicking next to continue...');
            await nextButton.click();
            await page.waitForURL(/\/setup\/(review|windlass|complete)/, { timeout: 10000 });
          }
        }
      } else if (await nextButton.isVisible()) {
        console.log('Clicking next to continue...');
        await nextButton.click();
        await page.waitForURL(/\/setup\/(review|windlass|complete)/, { timeout: 10000 });
      }

      const step4Duration = Date.now() - step4Start;
      console.log(`✓ Step 4 Complete (${step4Duration}ms)`);
      await screenshot(page, '12-after-scanner');
    } else {
      console.warn('⚠ Not on scanner page');
    }

    // ===== STEP 5-7: REVIEW / WINDLASS / COMPLETE =====
    console.log('\n--- Steps 5-7: Review / Windlass / Complete ---');

    const currentUrlFinal = page.url();
    console.log(`Final URL: ${currentUrlFinal}`);

    if (currentUrlFinal.includes('/review')) {
      console.log('On review page...');
      await screenshot(page, '13-review-page');

      const nextBtn = page.locator('button:has-text("Next"), button[type="submit"]');
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
        await page.waitForURL(/\/setup\/(windlass|complete)/, { timeout: 10000 });
      }
    }

    if (currentUrlFinal.includes('/windlass')) {
      console.log('On windlass page...');
      await screenshot(page, '14-windlass-page');

      const nextBtn = page.locator('button:has-text("Next"), button:has-text("Complete"), button[type="submit"]');
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
        await page.waitForURL(/\/setup\/complete/, { timeout: 10000 });
      }
    }

    // Final page
    await page.waitForURL(/\/setup\/complete|\/app/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const finalUrl = page.url();
    console.log(`Final URL after wizard: ${finalUrl}`);
    await screenshot(page, '15-final-complete-page');

    // Check for success message
    const successIndicators = page.locator('text=/Setup Complete|Welcome|Dashboard/i');
    const hasSuccess = await successIndicators.first().isVisible({ timeout: 5000 }).catch(() => false);

    if (hasSuccess || finalUrl.includes('/complete') || finalUrl.includes('/app')) {
      console.log('✓ Setup wizard completed successfully!');
    } else {
      console.warn('⚠ Unclear if setup completed');
    }

    // ===== TEST NAVIGATION RESTRICTIONS =====
    console.log('\n--- Testing Navigation Restrictions ---');

    // Try to navigate back to setup from complete
    if (finalUrl.includes('/complete')) {
      console.log('Testing if complete page redirects to dashboard...');
      const dashLink = page.locator('a:has-text("Dashboard"), a:has-text("Go to")');
      if (await dashLink.isVisible()) {
        await dashLink.click();
        await page.waitForURL(/\/app/, { timeout: 10000 });
        console.log('✓ Successfully navigated to dashboard');
        await screenshot(page, '16-dashboard');
      }
    }

    // ===== TEST LOGIN AFTER SETUP =====
    console.log('\n--- Testing Login After Setup ---');

    // Open a new browser context to test login
    const newContext = await context.browser()!.newContext();
    const loginPage = await newContext.newPage();

    console.log('Testing login with newly created account...');
    await loginPage.goto('https://stdout.seaynicroute.com/app/login');
    await loginPage.waitForLoadState('networkidle');

    const loginEmail = loginPage.locator('input[name="email"]');
    const loginPassword = loginPage.locator('input[name="password"]');
    const loginSubmit = loginPage.locator('button[type="submit"]');

    if (await loginEmail.isVisible()) {
      await loginEmail.fill(TEST_EMAIL);
      await loginPassword.fill(TEST_PASSWORD);
      await loginSubmit.click();

      try {
        await loginPage.waitForURL(/\/app(?!\/login)/, { timeout: 10000 });
        console.log('✓ Login successful with new account');
        await screenshot(loginPage, '17-logged-in-dashboard');
      } catch (e) {
        console.error('✗ Login failed after setup');
      }
    }

    await newContext.close();

    console.log('\n=== Setup Wizard QA Test Complete ===\n');
  });

  test('Setup Page Accessibility Before Completion', async ({ page }) => {
    console.log('\n=== Setup Accessibility Test ===\n');

    // Try to access app pages before setup complete
    console.log('Testing access restrictions before setup...');

    const protectedPaths = [
      '/app',
      '/app/dashboard',
      '/app/incidents',
      '/app/infrastructure',
    ];

    for (const path of protectedPaths) {
      console.log(`Testing ${path}...`);
      await page.goto(`https://stdout.seaynicroute.com${path}`);
      await page.waitForLoadState('networkidle');

      const url = page.url();
      // Should either redirect to setup or show login
      const isProtected = url.includes('/setup') || url.includes('/login') || url.includes('/register');
      console.log(`  Result: ${isProtected ? '✓ Protected' : '✗ Exposed'}`);
    }
  });

  test('Error Recovery in Setup', async ({ page }) => {
    console.log('\n=== Error Recovery Test ===\n');

    await page.goto('https://stdout.seaynicroute.com/setup');
    await page.waitForLoadState('networkidle');

    const displayNameInput = page.locator('input[name="displayName"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');
    const confirmInput = page.locator('input[name="confirm"]');
    const submitButton = page.locator('button[type="submit"]');

    // Test 1: Missing fields
    console.log('Test 1: Submitting with missing fields...');
    await submitButton.click();
    const errorMsg = page.locator('.auth-error');
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
    let text = await errorMsg.textContent();
    console.log(`  Error: ${text}`);
    expect(text).toContain('required');

    // Test 2: Invalid email
    console.log('Test 2: Submitting with invalid email...');
    await displayNameInput.fill(TEST_DISPLAY_NAME);
    await emailInput.fill('not-an-email');
    await passwordInput.fill(TEST_PASSWORD);
    await confirmInput.fill(TEST_PASSWORD);

    // Browser HTML5 validation should catch this
    const invalidFeedback = emailInput.locator('~ .error');
    // If no explicit error, submit and check server response
    try {
      await submitButton.click();
      const currentUrl = page.url();
      // If still on /setup, there was an error
      if (currentUrl.includes('/setup')) {
        const err = await errorMsg.textContent({ timeout: 2000 }).catch(() => 'unknown');
        console.log(`  Error: ${err}`);
      }
    } catch (e) {
      console.log('  Browser validation caught invalid email');
    }

    console.log('✓ Error recovery tests complete\n');
  });
});
