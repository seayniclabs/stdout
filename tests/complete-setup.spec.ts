import { test } from '@playwright/test';

test('Complete setup wizard E2E', async ({ page }) => {
  // Step 1: Create admin account
  console.log('Step 1: Creating admin account...');
  await page.goto('http://192.168.68.89:8117/setup');
  await page.fill('input[name="displayName"]', 'Charlie Seay');
  await page.fill('input[name="email"]', 'charlie@seayniclabs.com');  
  await page.fill('input[name="password"]', 'StdOut2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL(/setup\/(license|environment|scanner)/, { timeout: 10000 });
  console.log('✓ Account created, URL:', page.url());

  // Step 2: Handle license (skip if present)
  if (page.url().includes('/setup/license')) {
    console.log('Step 2: Skipping license...');
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.isVisible({ timeout: 2000 })) {
      await skipBtn.click();
      await page.waitForURL(/setup\/(scanner|environment)/, { timeout: 10000 });
    }
    console.log('✓ License handled, URL:', page.url());
  }

  // Step 3-6: Click through remaining steps
  for (let i = 0; i < 6; i++) {
    const currentUrl = page.url();
    console.log(`Step ${i+3}: At ${currentUrl}`);
    
    // Look for navigation buttons
    const buttons = ['Skip', 'Next', 'Continue', 'Complete Setup', 'Finish'];
    let clicked = false;
    
    for (const btnText of buttons) {
      const btn = page.locator(`button:has-text("${btnText}")`).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        console.log(`  Clicking "${btnText}"...`);
        await btn.click();
        await page.waitForTimeout(2000); // Wait for navigation
        clicked = true;
        break;
      }
    }
    
    if (!clicked || page.url().includes('/app') || page.url().includes('/complete')) {
      console.log('  No more wizard steps or reached app');
      break;
    }
  }

  console.log('Final URL:', page.url());
});
