import { test, expect } from '@playwright/test';
import { createAuthenticatedUser, apiRequest } from './helpers/auth';
import { testWebhookNotification, testEmailNotification } from './helpers/fixtures';

test.describe('Notifications (F69-F76)', () => {
  test.beforeEach(async ({ page }) => {
    await createAuthenticatedUser(page);
  });

  test('F69 — Add webhook notification', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      ...testWebhookNotification,
    });

    expect(status).toBe(200);
    expect(json.id).toBeTruthy();
  });

  test('F70 — Add email notification', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      ...testEmailNotification,
    });

    expect(status).toBe(200);
    expect(json.id).toBeTruthy();
  });

  test('F73 — Toggle notification off', async ({ page }) => {
    // Create first
    const create = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      ...testWebhookNotification,
    });
    const notifId = create.json.id;

    // Toggle off
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'toggle_notification',
      id: notifId,
      enabled: false,
    });

    expect(status).toBe(200);
    expect(json.toggled).toBe(true);
  });

  test('F74 — Delete notification', async ({ page }) => {
    // Create first
    const create = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      ...testWebhookNotification,
    });
    const notifId = create.json.id;

    // Delete
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'delete_notification',
      id: notifId,
    });

    expect(status).toBe(200);
    expect(json.deleted).toBe(true);
  });

  test('F76 — Invalid channel returns 400', async ({ page }) => {
    const { status, json } = await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      channel: 'sms',
      destination: '+15551234567',
      events: ['incident_created'],
    });

    expect(status).toBe(400);
    expect(json.error).toContain('Invalid channel');
  });

  test('F69-extra — Notification list in preferences', async ({ page }) => {
    // Create a notification
    await apiRequest(page, 'POST', '/app/api/preferences', {
      action: 'add_notification',
      ...testWebhookNotification,
    });

    // List preferences
    const { status, json } = await apiRequest(page, 'GET', '/app/api/preferences');
    expect(status).toBe(200);
    expect(json.notifications).toBeDefined();
    expect(json.notifications.length).toBeGreaterThanOrEqual(1);
  });
});
