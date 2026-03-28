import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.STDOUT_TEST_URL || 'http://localhost:4321';
const isHTTPS = BASE_URL.startsWith('https://');

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: {
      'Origin': BASE_URL,
    },
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    // WebKit/Safari enforces Secure cookie policy over HTTP — session cookies
    // set with secure:true won't be sent back on http://localhost.
    // Only enable mobile-safari when running against an HTTPS target.
    ...(isHTTPS ? [{
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    }] : []),
  ],
  // Rate limit tests must run last — they lock accounts/IPs
  // Use grep tags: npx playwright test --grep-invert @ratelimit first, then @ratelimit
});
