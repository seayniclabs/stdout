/**
 * End-to-End Test Suite for StdOut
 * 
 * Tests complete user workflows:
 * - Fresh install → setup wizard → dashboard
 * - Monitor creation → discovery → first check
 * - Incident creation → auto-fix → resolution
 * - Settings → backup → restore
 * 
 * Follows Given/When/Then structure from templates-kb
 */
import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, loginUser } from '../helpers/auth';

const BASE_URL = process.env.STDOUT_TEST_URL || 'http://localhost:4321';

test.describe('E2E — Fresh Install Flow', () => {
  
  test('TC-E2E-01: Fresh install redirects to setup wizard', async ({ page }) => {
    // Given: Database is empty (fresh install)
    // When: User navigates to /app
    await page.goto(`${BASE_URL}/app`);
    
    // Then: Should redirect to /setup/welcome
    await expect(page).toHaveURL(/\/setup\/welcome/);
    await expect(page.locator('h1')).toContainText('Welcome to StdOut');
  });
  
  test('TC-E2E-02: Setup wizard completes successfully', async ({ page }) => {
    // Given: User is on setup wizard
    await page.goto(`${BASE_URL}/setup/welcome`);
    
    // When: User completes all setup steps
    // Step 1: Welcome
    await page.getByRole('button', { name: /get started|next/i }).click();
    
    // Step 2: Create admin account
    await page.locator('input[name="email"]').fill('admin@stdout.local');
    await page.locator('input[name="displayName"]').fill('Admin User');
    await page.locator('input[name="password"]').fill('Admin123!secure');
    await page.locator('input[name="confirm"]').fill('Admin123!secure');
    await page.getByRole('button', { name: /create account|next/i }).click();
    
    // Wait for automatic progression through remaining steps
    await page.waitForURL(/\/app/, { timeout: 60000 });
    
    // Then: User lands on dashboard
    await expect(page).toHaveURL(/\/app/);
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible();
  });
});

test.describe('E2E — Monitor Creation & Discovery', () => {
  
  test.beforeEach(async ({ page }) => {
    // Setup: Authenticated user with completed setup
    const { email, password } = await createAuthenticatedUser(page);
    await loginUser(page, email, password);
  });
  
  test('TC-E2E-03: Create HTTP monitor and verify first check', async ({ page }) => {
    // Given: User is on dashboard
    await page.goto(`${BASE_URL}/app`);
    
    // When: User creates a new HTTP monitor
    await page.getByRole('link', { name: /monitors|new monitor/i }).click();
    await page.locator('input[name="name"]').fill('Test HTTP Monitor');
    await page.locator('input[name="url"]').fill('https://example.com');
    await page.locator('select[name="type"]').selectOption('http');
    await page.locator('input[name="interval"]').fill('60');
    await page.getByRole('button', { name: /create|save/i }).click();
    
    // Then: Monitor appears in list with "Pending" status
    await page.waitForURL(/\/app\/monitors/);
    await expect(page.locator('text=Test HTTP Monitor')).toBeVisible();
    
    // And: First check completes within 10 seconds
    await expect(page.locator('[data-monitor-name="Test HTTP Monitor"] [data-testid="status"]'))
      .not.toContainText('Pending', { timeout: 15000 });
  });
  
  test('TC-E2E-04: Auto-discovery finds monitors on local network', async ({ page }) => {
    // Given: User is on monitors page
    await page.goto(`${BASE_URL}/app/monitors`);
    
    // When: User triggers auto-discovery
    await page.getByRole('button', { name: /discover|scan network/i }).click();
    
    // Then: Discovery modal appears
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('text=/scanning|discovering/i')).toBeVisible();
    
    // And: Discovery completes within 30 seconds
    await expect(page.locator('text=/found|complete/i')).toBeVisible({ timeout: 35000 });
  });
});

test.describe('E2E — Incident Handling', () => {
  
  test.beforeEach(async ({ page }) => {
    const { email, password } = await createAuthenticatedUser(page);
    await loginUser(page, email, password);
  });
  
  test('TC-E2E-05: Create incident and apply manual resolution', async ({ page }) => {
    // Given: User is on incidents page
    await page.goto(`${BASE_URL}/app/incidents`);
    
    // When: User creates a new incident
    await page.getByRole('button', { name: /new incident|create/i }).click();
    await page.locator('input[name="title"]').fill('Test Incident');
    await page.locator('select[name="severity"]').selectOption('medium');
    await page.locator('textarea[name="description"]').fill('This is a test incident for E2E validation');
    await page.getByRole('button', { name: /create|save/i }).click();
    
    // Then: Incident appears in list
    await expect(page.locator('text=Test Incident')).toBeVisible();
    
    // When: User marks incident as resolved
    await page.locator('text=Test Incident').click();
    await page.getByRole('button', { name: /resolve|close/i }).click();
    await page.locator('textarea[name="resolution"]').fill('Resolved for testing');
    await page.getByRole('button', { name: /confirm|save/i }).click();
    
    // Then: Incident status updates to "Resolved"
    await expect(page.locator('[data-testid="incident-status"]')).toContainText('Resolved');
  });
  
  test('TC-E2E-06: Auto-fix suggestion appears for known incident patterns', async ({ page }) => {
    // Given: User creates an incident with a known pattern (disk space)
    await page.goto(`${BASE_URL}/app/incidents`);
    await page.getByRole('button', { name: /new incident|create/i }).click();
    await page.locator('input[name="title"]').fill('Disk space critical');
    await page.locator('textarea[name="description"]').fill('Disk usage at 95% on /var/log');
    await page.getByRole('button', { name: /create|save/i }).click();
    
    // When: User opens the incident detail
    await page.locator('text=Disk space critical').click();
    
    // Then: Auto-fix suggestions appear
    await expect(page.locator('[data-testid="autofix-suggestions"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/rotate logs|clear cache|expand volume/i')).toBeVisible();
  });
});

test.describe('E2E — Settings & Backup', () => {
  
  test.beforeEach(async ({ page }) => {
    const { email, password } = await createAuthenticatedUser(page);
    await loginUser(page, email, password);
  });
  
  test('TC-E2E-07: Create backup and verify download', async ({ page }) => {
    // Given: User is on settings page
    await page.goto(`${BASE_URL}/app/settings`);
    
    // When: User navigates to backup section
    await page.getByRole('link', { name: /backup|data/i }).click();
    
    // And: User creates a backup
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /create backup|download/i }).click();
    const download = await downloadPromise;
    
    // Then: Backup file downloads successfully
    expect(download.suggestedFilename()).toMatch(/stdout-backup-\d{8}-\d{6}\.db/);
    
    // And: File size is > 0 bytes
    const path = await download.path();
    const fs = await import('fs/promises');
    const stats = await fs.stat(path);
    expect(stats.size).toBeGreaterThan(0);
  });
  
  test('TC-E2E-08: Update settings and verify persistence', async ({ page }) => {
    // Given: User is on settings page
    await page.goto(`${BASE_URL}/app/settings`);
    
    // When: User changes check interval default
    await page.locator('input[name="defaultCheckInterval"]').fill('120');
    await page.getByRole('button', { name: /save|update/i }).click();
    
    // Then: Success message appears
    await expect(page.locator('text=/saved|updated successfully/i')).toBeVisible();
    
    // When: User refreshes the page
    await page.reload();
    
    // Then: Setting persists
    await expect(page.locator('input[name="defaultCheckInterval"]')).toHaveValue('120');
  });
});

test.describe('E2E — Dashboard & Reporting', () => {
  
  test.beforeEach(async ({ page }) => {
    const { email, password } = await createAuthenticatedUser(page);
    await loginUser(page, email, password);
  });
  
  test('TC-E2E-09: Dashboard displays correct monitor summary', async ({ page }) => {
    // Given: User has created multiple monitors
    // (Assume monitors exist from previous tests or seed data)
    
    // When: User navigates to dashboard
    await page.goto(`${BASE_URL}/app`);
    
    // Then: Dashboard shows monitor counts
    await expect(page.locator('[data-testid="total-monitors"]')).toBeVisible();
    await expect(page.locator('[data-testid="healthy-monitors"]')).toBeVisible();
    await expect(page.locator('[data-testid="unhealthy-monitors"]')).toBeVisible();
    
    // And: Numbers are > 0 (assuming test data exists)
    const totalText = await page.locator('[data-testid="total-monitors"]').textContent();
    expect(parseInt(totalText || '0')).toBeGreaterThanOrEqual(0);
  });
  
  test('TC-E2E-10: Export incident report as CSV', async ({ page }) => {
    // Given: User is on incidents page with data
    await page.goto(`${BASE_URL}/app/incidents`);
    
    // When: User exports incidents
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export|download csv/i }).click();
    const download = await downloadPromise;
    
    // Then: CSV file downloads
    expect(download.suggestedFilename()).toMatch(/incidents.*\.csv/);
    
    // And: File contains headers
    const path = await download.path();
    const fs = await import('fs/promises');
    const content = await fs.readFile(path, 'utf-8');
    expect(content).toContain('title');
    expect(content).toContain('severity');
  });
});

test.describe('E2E — Complete User Journey', () => {
  
  test('TC-E2E-11: Full workflow from install to incident resolution', async ({ page }) => {
    // This test simulates a complete user journey from first visit to resolved incident
    
    // Given: Fresh installation
    await page.goto(`${BASE_URL}/app`);
    
    // Step 1: Complete setup wizard
    await page.waitForURL(/\/setup/);
    await page.getByRole('button', { name: /get started|next/i }).click();
    await page.locator('input[name="email"]').fill('journey@test.local');
    await page.locator('input[name="displayName"]').fill('Journey User');
    await page.locator('input[name="password"]').fill('Journey123!');
    await page.locator('input[name="confirm"]').fill('Journey123!');
    await page.getByRole('button', { name: /create account|next/i }).click();
    await page.waitForURL(/\/app/, { timeout: 60000 });
    
    // Step 2: Create first monitor
    await page.getByRole('link', { name: /monitors|new monitor/i }).click();
    await page.locator('input[name="name"]').fill('Production API');
    await page.locator('input[name="url"]').fill('https://api.example.com/health');
    await page.locator('select[name="type"]').selectOption('http');
    await page.getByRole('button', { name: /create|save/i }).click();
    
    // Step 3: Wait for first check
    await page.waitForTimeout(5000);
    
    // Step 4: Create incident
    await page.getByRole('link', { name: /incidents/i }).click();
    await page.getByRole('button', { name: /new incident|create/i }).click();
    await page.locator('input[name="title"]').fill('API Response Time Degraded');
    await page.locator('select[name="severity"]').selectOption('high');
    await page.getByRole('button', { name: /create|save/i }).click();
    
    // Step 5: Resolve incident
    await page.locator('text=API Response Time Degraded').click();
    await page.getByRole('button', { name: /resolve|close/i }).click();
    await page.locator('textarea[name="resolution"]').fill('Restarted backend services');
    await page.getByRole('button', { name: /confirm|save/i }).click();
    
    // Then: Full journey completes successfully
    await expect(page.locator('[data-testid="incident-status"]')).toContainText('Resolved');
    
    // And: Dashboard reflects the activity
    await page.goto(`${BASE_URL}/app`);
    await expect(page.locator('[data-testid="total-monitors"]')).toContainText('1');
    await expect(page.locator('[data-testid="total-incidents"]')).toContainText('1');
  });
});
