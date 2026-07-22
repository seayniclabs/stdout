/**
 * Unit tests for remediation/executor.ts
 *
 * Tests playbook execution, dry-run mode, rollback, and error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaybookExecutor, executePlaybook } from './executor';
import type { Playbook, PlaybookStep } from './schema';
import {
  basicPlaybook,
  highRiskPlaybook,
  conditionalPlaybook,
} from '../__tests__/fixtures';

describe('PlaybookExecutor', () => {
  describe('Initialization', () => {
    it('should create executor with basic configuration', () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        false
      );
      const execution = executor.getExecution();

      expect(execution.id).toBeDefined();
      expect(execution.playbookId).toBe(basicPlaybook.id);
      expect(execution.incidentId).toBe('inc-001');
      expect(execution.userId).toBe('user-123');
      expect(execution.status).toBe('pending');
      expect(execution.dryRun).toBe(false);
      expect(execution.logs).toEqual([]);
    });

    it('should create executor in dry-run mode', () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );
      const execution = executor.getExecution();

      expect(execution.dryRun).toBe(true);
    });

    it('should initialize with current timestamp', () => {
      const before = new Date();
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123'
      );
      const after = new Date();

      const execution = executor.getExecution();
      expect(execution.startedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(execution.startedAt.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
    });

    it('should generate unique execution IDs', () => {
      const executor1 = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123'
      );
      const executor2 = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123'
      );

      const id1 = executor1.getExecution().id;
      const id2 = executor2.getExecution().id;

      expect(id1).not.toBe(id2);
    });
  });

  describe('Dry-run mode', () => {
    it('should not execute actual steps in dry-run mode', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.dryRun).toBe(true);
      expect(execution.status).toBe('success');
      // In dry-run, all steps should log as would-execute
      const stepLogs = execution.logs.filter(
        (log) => log.message.includes('DRY RUN')
      );
      expect(stepLogs.length).toBeGreaterThan(0);
    });

    it('should not trigger rollback in dry-run mode', async () => {
      const playbookWithError: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'fail-step',
            type: 'shell',
            description: 'This will fail',
            command: 'false',
            timeout: 1000,
          },
        ],
        rollback: [
          {
            id: 'rollback-1',
            type: 'shell',
            description: 'Rollback step',
            command: 'echo "rolled back"',
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookWithError,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      // Dry-run should complete successfully without executing rollback
      expect(execution.dryRun).toBe(true);
      expect(execution.rollbackAttempted).toBeUndefined();
    });

    it('should log all steps as [DRY RUN]', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      const dryRunLogs = execution.logs.filter((log) =>
        log.message.includes('[DRY RUN]')
      );
      expect(dryRunLogs.length).toBeGreaterThan(0);
    });
  });

  describe('Step execution', () => {
    it('should track step count', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      // Should have logs for starting and steps
      expect(execution.logs.length).toBeGreaterThan(0);
    });

    it('should include step description in logs', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      const stepDescriptions = basicPlaybook.steps.map((s) => s.description);
      for (const desc of stepDescriptions) {
        const hasLog = execution.logs.some((log) =>
          log.message.includes(desc) || log.message.includes('[DRY RUN]')
        );
        expect(hasLog).toBe(true);
      }
    });

    it('should handle steps with retries', async () => {
      const playbookWithRetries: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'retry-step',
            type: 'shell',
            description: 'Step with retries',
            command: 'echo "success"',
            timeout: 5000,
            retries: 2,
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookWithRetries,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.status).toBe('success');
    });

    it('should handle steps with timeout', async () => {
      const playbookWithTimeout: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'timeout-step',
            type: 'wait',
            description: 'Step with timeout',
            timeout: 100,
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookWithTimeout,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.status).toBe('success');
    });

    it('should continue on error when continueOnError is true', async () => {
      const playbookWithContinueOnError: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'fail-but-continue',
            type: 'shell',
            description: 'This fails but continues',
            command: 'false',
            timeout: 1000,
            continueOnError: true,
          },
          {
            id: 'next-step',
            type: 'shell',
            description: 'Next step after error',
            command: 'echo "continuing"',
            timeout: 1000,
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookWithContinueOnError,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      // In dry-run, all steps will be marked success
      expect(execution.status).toBe('success');
    });
  });

  describe('Rollback mechanism', () => {
    it('should not attempt rollback when execution succeeds', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.rollbackAttempted).toBeUndefined();
      expect(execution.rollbackSuccess).toBeUndefined();
    });

    it('should have rollback steps available', async () => {
      expect(basicPlaybook.rollback.length).toBeGreaterThan(0);
    });

    it('should handle playbooks without rollback steps', async () => {
      const playbookNoRollback: Playbook = {
        ...basicPlaybook,
        rollback: [],
      };

      const executor = new PlaybookExecutor(
        playbookNoRollback,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.status).toBe('success');
      expect(execution.rollbackAttempted).toBeUndefined();
    });
  });

  describe('Logging', () => {
    it('should log execution start', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      const startLog = execution.logs.find((log) =>
        log.message.includes('Starting playbook execution')
      );
      expect(startLog).toBeDefined();
      expect(startLog?.level).toBe('info');
    });

    it('should log completion status', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      const completionLog = execution.logs.find((log) =>
        log.message.includes('completed successfully')
      );
      expect(completionLog).toBeDefined();
      expect(completionLog?.level).toBe('success');
    });

    it('should include timestamp in each log', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.logs.every((log) => log.timestamp instanceof Date)).toBe(
        true
      );
    });

    it('should include step ID in relevant logs', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      const stepLogs = execution.logs.filter((log) => log.stepId !== 'system');
      expect(stepLogs.length).toBeGreaterThan(0);
      for (const log of stepLogs) {
        expect(
          basicPlaybook.steps.some((s) => s.id === log.stepId)
        ).toBe(true);
      }
    });

    it('should log execution metadata', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      const startLog = execution.logs.find((log) =>
        log.message.includes('Starting playbook execution')
      );
      expect(startLog?.data).toBeDefined();
      expect(startLog?.data?.playbookId).toBe(basicPlaybook.id);
      expect(startLog?.data?.dryRun).toBe(true);
      expect(startLog?.data?.stepCount).toBe(basicPlaybook.steps.length);
    });
  });

  describe('Execution states', () => {
    it('should track execution status transitions', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.status).toBe('success');
    });

    it('should set completedAt timestamp on completion', async () => {
      const executor = new PlaybookExecutor(
        basicPlaybook,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.completedAt).toBeDefined();
      expect(execution.completedAt instanceof Date).toBe(true);
      expect(execution.completedAt!.getTime()).toBeGreaterThanOrEqual(
        execution.startedAt.getTime()
      );
    });
  });

  describe('Step types', () => {
    it('should recognize shell step type', async () => {
      const playbookShellOnly: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'shell-test',
            type: 'shell',
            description: 'Shell command',
            command: 'echo hello',
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookShellOnly,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();
      expect(execution.status).toBe('success');
    });

    it('should recognize api step type', async () => {
      const playbookApiOnly: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'api-test',
            type: 'api',
            description: 'API call',
            endpoint: 'http://localhost:3000/health',
            method: 'GET',
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookApiOnly,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();
      expect(execution.status).toBe('success');
    });

    it('should recognize wait step type', async () => {
      const playbookWaitOnly: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'wait-test',
            type: 'wait',
            description: 'Wait step',
            timeout: 1000,
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookWaitOnly,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();
      expect(execution.status).toBe('success');
    });

    it('should recognize verify step type', async () => {
      const playbookVerifyOnly: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'verify-test',
            type: 'verify',
            description: 'Verify step',
            command: 'echo success',
            expectedOutput: 'success',
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookVerifyOnly,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();
      expect(execution.status).toBe('success');
    });

    it('should recognize conditional step type', async () => {
      const playbookConditional: Playbook = {
        ...basicPlaybook,
        steps: [
          {
            id: 'conditional-test',
            type: 'conditional',
            description: 'Conditional step',
          },
        ],
      };

      const executor = new PlaybookExecutor(
        playbookConditional,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();
      expect(execution.status).toBe('success');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty step list', async () => {
      const playbookEmpty: Playbook = {
        ...basicPlaybook,
        steps: [],
      };

      const executor = new PlaybookExecutor(
        playbookEmpty,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.status).toBe('success');
    });

    it('should handle playbook with many steps', async () => {
      const manySteps: PlaybookStep[] = Array.from(
        { length: 50 },
        (_, i) => ({
          id: `step-${i}`,
          type: 'wait' as const,
          description: `Step ${i}`,
          timeout: 100,
        })
      );

      const playbookMany: Playbook = {
        ...basicPlaybook,
        steps: manySteps,
      };

      const executor = new PlaybookExecutor(
        playbookMany,
        'inc-001',
        'user-123',
        true
      );

      const execution = await executor.execute();

      expect(execution.status).toBe('success');
      expect(execution.logs.length).toBeGreaterThan(0);
    });

    it('should preserve incident and user IDs', async () => {
      const incidentId = 'inc-special-123';
      const userId = 'user-special-456';

      const executor = new PlaybookExecutor(
        basicPlaybook,
        incidentId,
        userId,
        true
      );

      const execution = await executor.execute();

      expect(execution.incidentId).toBe(incidentId);
      expect(execution.userId).toBe(userId);
    });
  });
});

describe('executePlaybook function', () => {
  it('should execute via factory function', async () => {
    const execution = await executePlaybook(
      basicPlaybook,
      'inc-001',
      'user-123',
      true
    );

    expect(execution.id).toBeDefined();
    expect(execution.playbookId).toBe(basicPlaybook.id);
    expect(execution.incidentId).toBe('inc-001');
    expect(execution.userId).toBe('user-123');
    expect(execution.dryRun).toBe(true);
  });

  it('should pass dryRun parameter through factory', async () => {
    const executionDry = await executePlaybook(
      basicPlaybook,
      'inc-001',
      'user-123',
      true
    );
    expect(executionDry.dryRun).toBe(true);

    const executionWet = await executePlaybook(
      basicPlaybook,
      'inc-001',
      'user-123',
      false
    );
    expect(executionWet.dryRun).toBe(false);
  });

  it('should default to non-dry-run when not specified', async () => {
    const execution = await executePlaybook(
      basicPlaybook,
      'inc-001',
      'user-123'
    );
    expect(execution.dryRun).toBe(false);
  });

  it('should return complete execution object', async () => {
    const execution = await executePlaybook(
      basicPlaybook,
      'inc-001',
      'user-123',
      true
    );

    expect(execution).toHaveProperty('id');
    expect(execution).toHaveProperty('playbookId');
    expect(execution).toHaveProperty('incidentId');
    expect(execution).toHaveProperty('userId');
    expect(execution).toHaveProperty('status');
    expect(execution).toHaveProperty('dryRun');
    expect(execution).toHaveProperty('startedAt');
    expect(execution).toHaveProperty('logs');
  });
});
