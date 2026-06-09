import { test } from '@playwright/test';

test('check scanner state after completion', async ({ page }) => {
  test.setTimeout(600000);
  
  // Setup steps (abbreviated)
  await page.goto('http://192.168.0.244:8112');
  await page.fill('input[name="displayName"]', 'Test Admin');
  await page.fill('input[name="email"]', 'admin@test.local');
  await page.fill('input[name="password"]', 'Test123!@#Admin');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/setup\/environment$/);
  await page.fill('input[name="environmentName"]', 'Test Environment');
  await page.click('button:has-text("Continue")');
  await page.waitForURL(/\/setup\/license$/);
  await page.click('button:has-text("Skip for Now")');
  await page.waitForURL(/\/setup\/scanner$/);
  
  // Click scan
  await page.click('button#scanButton');
  await page.waitForSelector('#scanProgress', { state: 'visible' });
  
  // Wait for completion
  await page.waitForSelector('.status-icon:has-text("✅")', { timeout: 300000 });
  
  console.log('Scan completed. Waiting 5 seconds...');
  await page.waitForTimeout(5000);
  
  // Check current URL
  console.log('Current URL:', page.url());
  
  // Check console logs
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/scanner-state.png', fullPage: true });
  console.log('Screenshot saved to /tmp/scanner-state.png');
  
  // Check if redirect happened
  console.log('Page is still on scanner:', page.url().includes('/setup/scanner'));
});
