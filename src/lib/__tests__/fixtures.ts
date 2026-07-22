/**
 * Shared test fixtures for auto-remediation and cost tracking tests
 */

import type { Playbook, PlaybookStep, RemediationExecution } from '../remediation/schema';
import type { CostTrackingOptions } from '../cost-calculator';

/**
 * Fixture: Basic playbook for testing
 */
export const basicPlaybook: Playbook = {
  id: 'pb-basic-001',
  name: 'Basic Restart Playbook',
  description: 'Restarts a service and verifies health',
  trigger: {
    type: 'incident_fingerprint',
    pattern: 'service-.*-down',
  },
  steps: [
    {
      id: 'step-1',
      type: 'shell',
      description: 'Stop the service',
      command: 'systemctl stop myservice',
      timeout: 10000,
      retries: 1,
    },
    {
      id: 'step-2',
      type: 'wait',
      description: 'Wait for graceful shutdown',
      timeout: 5000,
    },
    {
      id: 'step-3',
      type: 'shell',
      description: 'Start the service',
      command: 'systemctl start myservice',
      timeout: 10000,
      retries: 1,
    },
    {
      id: 'step-4',
      type: 'verify',
      description: 'Verify service is running',
      command: 'systemctl is-active myservice',
      expectedOutput: 'active',
      timeout: 5000,
    },
  ],
  rollback: [
    {
      id: 'rollback-1',
      type: 'shell',
      description: 'Restore original state',
      command: 'systemctl restart myservice',
      timeout: 15000,
    },
  ],
  requiresApproval: false,
  timeout: 60,
  riskLevel: 'low',
  tags: ['restart', 'auto-remediation', 'service'],
  isBuiltIn: true,
  version: '1.0.0',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

/**
 * Fixture: High-risk playbook requiring approval
 */
export const highRiskPlaybook: Playbook = {
  ...basicPlaybook,
  id: 'pb-high-risk-001',
  name: 'Database Emergency Cleanup',
  description: 'Removes stale database connections forcefully',
  riskLevel: 'high',
  requiresApproval: true,
  timeout: 120,
  steps: [
    {
      id: 'step-1',
      type: 'api',
      description: 'Kill old connections',
      endpoint: 'http://localhost:5432/admin/kill-connections',
      method: 'POST',
      payload: { older_than_seconds: 3600 },
      expectedStatus: 200,
      timeout: 30000,
    },
    {
      id: 'step-2',
      type: 'api',
      description: 'Verify connection count',
      endpoint: 'http://localhost:5432/admin/connection-count',
      method: 'GET',
      expectedStatus: 200,
      timeout: 5000,
    },
  ],
  rollback: [
    {
      id: 'rollback-1',
      type: 'shell',
      description: 'Log warning to audit trail',
      command: 'echo "Database connection cleanup rolled back" >> /var/log/database.log',
    },
  ],
};

/**
 * Fixture: Playbook with conditional steps
 */
export const conditionalPlaybook: Playbook = {
  ...basicPlaybook,
  id: 'pb-conditional-001',
  name: 'Conditional Pod Restart',
  steps: [
    {
      id: 'check-pod',
      type: 'conditional',
      description: 'Check if pod is in crashloop',
      timeout: 5000,
    },
    {
      id: 'restart-pod',
      type: 'shell',
      description: 'Restart the pod',
      command: 'kubectl rollout restart deployment/my-app',
      timeout: 30000,
      continueOnError: true,
    },
  ],
  rollback: [],
};

/**
 * Fixture: Cost tracking options for different providers
 */
export const costTrackingOptions = {
  claude: {
    incidentId: 'inc-001',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    promptTokens: 1500,
    completionTokens: 500,
  } as CostTrackingOptions,

  gpt4: {
    incidentId: 'inc-002',
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 2000,
    completionTokens: 800,
  } as CostTrackingOptions,

  gemini: {
    incidentId: 'inc-003',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    promptTokens: 5000,
    completionTokens: 1500,
  } as CostTrackingOptions,

  haiku: {
    incidentId: 'inc-004',
    provider: 'anthropic',
    model: 'claude-haiku',
    promptTokens: 1000,
    completionTokens: 300,
  } as CostTrackingOptions,

  ollama: {
    incidentId: 'inc-005',
    provider: 'ollama',
    model: 'any',
    promptTokens: 10000,
    completionTokens: 5000,
  } as CostTrackingOptions,
};

/**
 * Fixture: Cost audit data
 */
export const costAuditFixtures = [
  {
    id: 'audit-001',
    incidentId: 'inc-001',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    promptTokens: 1500,
    completionTokens: 500,
    costUsd: 0.009,
    createdAt: new Date('2026-07-01T10:00:00Z'),
  },
  {
    id: 'audit-002',
    incidentId: 'inc-001',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    promptTokens: 2000,
    completionTokens: 1000,
    costUsd: 0.015,
    createdAt: new Date('2026-07-01T11:00:00Z'),
  },
  {
    id: 'audit-003',
    incidentId: 'inc-002',
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 3000,
    completionTokens: 2000,
    costUsd: 0.06,
    createdAt: new Date('2026-07-01T12:00:00Z'),
  },
  {
    id: 'audit-004',
    incidentId: 'inc-003',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    promptTokens: 10000,
    completionTokens: 5000,
    costUsd: 0.004,
    createdAt: new Date('2026-07-01T13:00:00Z'),
  },
];

/**
 * Fixture: Expected execution states
 */
export const executionStates = {
  pending: {
    status: 'pending' as const,
    playbookId: basicPlaybook.id,
    incidentId: 'inc-001',
    userId: 'user-123',
    dryRun: false,
    startedAt: new Date(),
    logs: [],
  },

  running: {
    status: 'running' as const,
    playbookId: basicPlaybook.id,
    incidentId: 'inc-001',
    userId: 'user-123',
    dryRun: false,
    startedAt: new Date(),
    logs: [
      {
        timestamp: new Date(),
        stepId: 'system',
        level: 'info' as const,
        message: 'Starting playbook execution',
      },
    ],
  },

  success: {
    status: 'success' as const,
    playbookId: basicPlaybook.id,
    incidentId: 'inc-001',
    userId: 'user-123',
    dryRun: false,
    startedAt: new Date(),
    completedAt: new Date(),
    logs: [
      {
        timestamp: new Date(),
        stepId: 'step-1',
        level: 'success' as const,
        message: 'Step completed successfully',
      },
    ],
  },

  failed: {
    status: 'failed' as const,
    playbookId: basicPlaybook.id,
    incidentId: 'inc-001',
    userId: 'user-123',
    dryRun: false,
    startedAt: new Date(),
    completedAt: new Date(),
    logs: [
      {
        timestamp: new Date(),
        stepId: 'step-1',
        level: 'error' as const,
        message: 'Step execution failed',
      },
    ],
  },

  rolledBack: {
    status: 'rolled_back' as const,
    playbookId: basicPlaybook.id,
    incidentId: 'inc-001',
    userId: 'user-123',
    dryRun: false,
    startedAt: new Date(),
    completedAt: new Date(),
    rollbackAttempted: true,
    rollbackSuccess: true,
    logs: [
      {
        timestamp: new Date(),
        stepId: 'system',
        level: 'warn' as const,
        message: 'Attempting rollback',
      },
    ],
  },
};

/**
 * Test API responses for validators
 */
export const apiResponses = {
  ollama: {
    response: 'The service is running correctly',
    prompt_eval_count: 150,
    eval_count: 50,
    total_duration: 250000000,
    load_duration: 50000000,
  },

  openai: {
    choices: [
      {
        message: {
          content: 'The issue is a DNS resolution problem',
        },
      },
    ],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 100,
    },
    model: 'gpt-4o',
  },

  anthropic: {
    id: 'msg-001',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'Automatic remediation initiated for pod restart',
      },
    ],
    model: 'claude-sonnet-4',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 250,
      output_tokens: 75,
    },
  },
};

/**
 * Invalid API responses for validation error testing
 */
export const invalidApiResponses = {
  missingField: {
    choices: [
      {
        // Missing message
      },
    ],
  },

  emptyChoices: {
    choices: [],
  },

  malformedUsage: {
    choices: [
      {
        message: {
          content: 'Response',
        },
      },
    ],
    usage: 'not-an-object',
  },

  nullResponse: null,

  notAnObject: 'just a string',
};
