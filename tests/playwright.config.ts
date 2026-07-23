import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const BASE_URL = process.env.STDOUT_TEST_URL || 'http://localhost:4321';
const isHTTPS = BASE_URL.startsWith('https://');

// When a pre-seeded test user is configured (frozen-registration env),
// global-setup logs in once and all tests reuse the saved session state.
const hasTestUser = !!(process.env.STDOUT_TEST_EMAIL && process.env.STDOUT_TEST_PASSWORD);
const AUTH_FILE = path.join(process.cwd(), 'playwright', '.auth', 'member.json');

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  globalSetup: hasTestUser ? './global-setup.ts' : undefined,
  globalTeardown: './global-teardown.ts',
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Pre-load the saved session for all tests when test user is configured.
    // createAuthenticatedUser() will navigate to /app rather than logging in.
    storageState: hasTestUser ? AUTH_FILE : undefined,
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
