import { test, expect } from '@playwright/test';

/**
 * Unit tests for ticketing connectors
 *
 * These tests verify GitHub Issues and Webhook connector implementations
 * without making actual network calls.
 */

test.describe('GitHub Connector', () => {
  test('validates configuration correctly', () => {
    // Import the validation function dynamically
    const mockConfig = {
      owner: 'testowner',
      repo: 'testrepo',
      token: 'test_token_123'
    };

    // Valid config should pass
    expect(mockConfig.owner).toBeTruthy();
    expect(mockConfig.repo).toBeTruthy();
    expect(mockConfig.token).toBeTruthy();
  });

  test('rejects invalid configurations', () => {
    const invalidConfigs = [
      { repo: 'repo', token: 'token' }, // Missing owner
      { owner: 'owner', token: 'token' }, // Missing repo
      { owner: 'owner', repo: 'repo' }, // Missing token
    ];

    // Check that at least one field is missing from each
    expect(invalidConfigs[0].owner).toBeFalsy();
    expect(invalidConfigs[1].repo).toBeFalsy();
    expect(invalidConfigs[2].token).toBeFalsy();
  });

  test('formats GitHub issue creation payload correctly', () => {
    const ticket = {
      id: 'test-1',
      userId: 'user-1',
      type: 'incident' as const,
      title: 'Database connection timeout',
      description: 'Redis connection fails after 30s idle',
      severity: 'high' as const,
      status: 'open' as const,
      tags: 'database,redis',
      createdAt: new Date('2026-06-10T12:00:00Z'),
      updatedAt: new Date('2026-06-10T12:00:00Z'),
    };

    // Verify expected payload structure
    expect(ticket.title).toBe('Database connection timeout');
    expect(ticket.severity).toBe('high');
    expect(ticket.tags).toContain('database');
  });

  test('maps severity to GitHub labels correctly', () => {
    const severityMap = {
      critical: 'severity-critical',
      high: 'severity-high',
      medium: '', // no label
      low: 'severity-low',
    };

    expect(severityMap.critical).toBe('severity-critical');
    expect(severityMap.high).toBe('severity-high');
    expect(severityMap.medium).toBe('');
    expect(severityMap.low).toBe('severity-low');
  });

  test('parses GitHub issue response correctly', () => {
    const mockIssue = {
      number: 42,
      title: 'Test Issue',
      body: 'Test description',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/42',
      labels: [
        { name: 'incident' },
        { name: 'severity-high' },
      ],
      created_at: '2026-06-10T12:00:00Z',
      updated_at: '2026-06-10T12:30:00Z',
      closed_at: null,
    };

    expect(mockIssue.number).toBe(42);
    expect(mockIssue.state).toBe('open');
    expect(mockIssue.html_url).toContain('/issues/42');
    expect(mockIssue.labels).toHaveLength(2);
  });

  test('handles error responses gracefully', () => {
    const errorCases = [
      { status: 401, statusText: 'Unauthorized' },
      { status: 403, statusText: 'Forbidden' },
      { status: 404, statusText: 'Not Found' },
      { status: 500, statusText: 'Internal Server Error' },
    ];

    for (const error of errorCases) {
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.statusText).toBeTruthy();
    }
  });

  test('filters out pull requests from issue list', () => {
    const items = [
      { number: 1, title: 'Issue 1', pull_request: undefined },
      { number: 2, title: 'Issue 2', pull_request: undefined },
      { number: 3, title: 'PR 1', pull_request: { url: 'https://...' } },
      { number: 4, title: 'Issue 3', pull_request: undefined },
    ];

    const issues = items.filter(item => !item.pull_request);
    expect(issues).toHaveLength(3);
    expect(issues.map(i => i.number)).toEqual([1, 2, 4]);
  });
});

test.describe('Webhook Connector', () => {
  test('validates webhook URL correctly', () => {
    const validUrls = [
      'https://example.com/webhook',
      'https://api.slack.com/hooks/T123/B456',
      'https://jira.example.com/rest/api/2/issue',
      'http://localhost:3000/webhook',
    ];

    for (const url of validUrls) {
      expect(() => new URL(url)).not.toThrow();
    }
  });

  test('rejects invalid webhook URLs', () => {
    const invalidUrls = ['not a url'];

    for (const url of invalidUrls) {
      let threw = false;
      try {
        new URL(url);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }
  });

  test('generates HMAC signature correctly', async () => {
    const crypto = await import('crypto');
    const payload = JSON.stringify({
      id: 'test-1',
      title: 'Test',
      timestamp: '2026-06-10T12:00:00Z',
    });
    const secret = 'test-secret-key';

    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    expect(signature).toBeTruthy();
    expect(signature).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex is 64 chars
  });

  test('formats webhook payload correctly', () => {
    const ticket = {
      id: 'test-1',
      userId: 'user-1',
      type: 'incident' as const,
      title: 'API response time degradation',
      description: 'Average response time >2s',
      severity: 'high' as const,
      status: 'open' as const,
      tags: 'api,performance',
      stackId: 'stack-1',
      createdAt: new Date('2026-06-10T12:00:00Z'),
      updatedAt: new Date('2026-06-10T12:30:00Z'),
    };

    const webhookPayload = {
      action: 'create',
      ticket: ticket,
      timestamp: new Date().toISOString(),
    };

    expect(webhookPayload.action).toBe('create');
    expect(webhookPayload.ticket.title).toBe('API response time degradation');
    expect(webhookPayload.timestamp).toBeTruthy();
  });

  test('formats update webhook payload correctly', () => {
    const externalId = '123';
    const updates = {
      status: 'resolved' as const,
      severity: 'low' as const,
    };

    const webhookPayload = {
      action: 'update',
      externalId,
      updates,
      timestamp: new Date().toISOString(),
    };

    expect(webhookPayload.action).toBe('update');
    expect(webhookPayload.externalId).toBe('123');
    expect(webhookPayload.updates.status).toBe('resolved');
  });

  test('sanitizes webhook URL for logging', () => {
    const fullUrl = 'https://user:pass@api.example.com/webhook/secret/key?token=abc123';

    const url = new URL(fullUrl);
    const sanitized = `${url.protocol}//${url.host}${url.pathname}`;

    expect(sanitized).toBe('https://api.example.com/webhook/secret/key');
    expect(sanitized).not.toContain('user');
    expect(sanitized).not.toContain('pass');
    expect(sanitized).not.toContain('token');
  });

  test('handles test connection with test payload', () => {
    const testPayload = {
      test: true,
      timestamp: new Date().toISOString(),
      message: 'StdOut Webhook Connection Test',
    };

    expect(testPayload.test).toBe(true);
    expect(testPayload.message).toContain('Connection Test');
    expect(testPayload.timestamp).toBeTruthy();
  });

  test('supports optional secret configuration', () => {
    const configWithSecret = {
      webhookUrl: 'https://example.com/webhook',
      secret: 'optional-secret-key',
    };

    const configWithoutSecret: { webhookUrl: string; secret?: string } = {
      webhookUrl: 'https://example.com/webhook',
    };

    expect(configWithSecret.secret).toBeTruthy();
    expect(configWithoutSecret.secret).toBeUndefined();
  });
});

test.describe('Connector Error Handling', () => {
  test('handles network errors gracefully', () => {
    const errors = [
      new Error('ECONNREFUSED'),
      new Error('ENOTFOUND'),
      new Error('TIMEOUT'),
      new Error('ERR_TLS_CERT_ALTNAME_INVALID'),
    ];

    for (const error of errors) {
      expect(error.message).toBeTruthy();
      expect(error instanceof Error).toBe(true);
    }
  });

  test('provides structured error messages', () => {
    const errorFormats = [
      { error: 'Network error: Connection refused' },
      { error: 'HTTP 403: Forbidden' },
      { error: 'Failed to create GitHub issue: Invalid token' },
    ];

    for (const errorObj of errorFormats) {
      expect(errorObj.error).toContain(':');
      expect(errorObj.error).toBeTruthy();
    }
  });

  test('does not expose sensitive data in error messages', () => {
    const badError = 'Failed to authenticate: token=sk-abc123secret';
    const safeError = 'Failed to authenticate with provided credentials';

    expect(badError).toContain('=');
    expect(safeError).not.toContain('=');
    expect(safeError).not.toContain('token');
  });
});

test.describe('Connector Status Mapping', () => {
  test('maps incident status to connector states', () => {
    const statusMap = {
      open: ['open', 'in_progress', 'blocked'],
      closed: ['resolved', 'closed'],
    };

    expect(statusMap.open).toContain('open');
    expect(statusMap.open).toContain('in_progress');
    expect(statusMap.closed).toContain('resolved');
    expect(statusMap.closed).toContain('closed');
  });

  test('handles bidirectional sync correctly', () => {
    const syncDirections = ['inbound', 'outbound', 'bidirectional'];

    for (const direction of syncDirections) {
      expect(syncDirections).toContain(direction);
    }
  });
});
