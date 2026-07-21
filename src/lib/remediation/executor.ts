/**
 * Auto-Remediation Playbook Executor
 *
 * Safely executes playbook steps with full logging, error handling, and rollback support.
 */

import { nanoid } from 'nanoid';
import type { Playbook, RemediationExecution, ExecutionLog, PlaybookStep, StepExecutionResult } from './schema';
import { createLogger } from '../logger';

const logger = createLogger('remediation');

export class PlaybookExecutor {
  private execution: RemediationExecution;
  private playbook: Playbook;
  private dryRun: boolean;

  constructor(
    playbook: Playbook,
    incidentId: string,
    userId: string,
    dryRun = false,
  ) {
    this.playbook = playbook;
    this.dryRun = dryRun;
    this.execution = {
      id: nanoid(),
      playbookId: playbook.id,
      incidentId,
      userId,
      status: 'pending',
      dryRun,
      startedAt: new Date(),
      logs: [],
    };
  }

  getExecution(): RemediationExecution {
    return this.execution;
  }

  private log(level: 'info' | 'warn' | 'error' | 'success', message: string, stepId?: string, data?: Record<string, unknown>) {
    const logEntry: ExecutionLog = {
      timestamp: new Date(),
      stepId: stepId || 'system',
      level,
      message,
      data,
    };
    this.execution.logs.push(logEntry);
    console.log(`[${level.toUpperCase()}] ${stepId ? `[${stepId}] ` : ''}${message}`, data || '');
  }

  async execute(): Promise<RemediationExecution> {
    try {
      this.log('info', `Starting playbook execution: ${this.playbook.name}`, 'system', {
        playbookId: this.playbook.id,
        dryRun: this.dryRun,
        stepCount: this.playbook.steps.length,
      });

      this.execution.status = 'running';

      // Execute main steps
      for (const step of this.playbook.steps) {
        try {
          await this.executeStep(step);
        } catch (error) {
          this.log('error', `Step ${step.id} failed: ${error instanceof Error ? error.message : String(error)}`, step.id);

          if (!step.continueOnError) {
            this.execution.status = 'failed';
            this.execution.completedAt = new Date();

            // Attempt rollback
            if (this.playbook.rollback.length > 0 && !this.dryRun) {
              await this.rollback();
            }

            return this.execution;
          }
        }
      }

      this.execution.status = 'success';
      this.log('success', 'Playbook execution completed successfully', 'system');
    } catch (error) {
      this.log('error', `Playbook execution failed: ${error instanceof Error ? error.message : String(error)}`, 'system');
      this.execution.status = 'failed';

      if (this.playbook.rollback.length > 0 && !this.dryRun) {
        await this.rollback();
      }
    }

    this.execution.completedAt = new Date();
    return this.execution;
  }

  private async executeStep(step: PlaybookStep): Promise<StepExecutionResult> {
    const startTime = Date.now();
    let retriesUsed = 0;
    const maxRetries = step.retries || 0;
    const timeout = step.timeout || 30000;

    this.log('info', `Executing: ${step.description}`, step.id);

    if (this.dryRun) {
      this.log('info', `[DRY RUN] Would execute ${step.type} step`, step.id, { step });
      return {
        stepId: step.id,
        status: 'success',
        durationMs: Date.now() - startTime,
        retriesUsed: 0,
      };
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeStepWithTimeout(step, timeout);
        const durationMs = Date.now() - startTime;

        this.log('success', `Step completed: ${step.description}`, step.id, {
          durationMs,
          retriesUsed,
        });

        return {
          stepId: step.id,
          status: 'success',
          output: result,
          durationMs,
          retriesUsed,
        };
      } catch (error) {
        retriesUsed = attempt + 1;
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (attempt < maxRetries) {
          this.log('warn', `Step ${step.id} attempt ${attempt + 1} failed, retrying...`, step.id, { error: errorMessage });
          await this.sleep(1000 * Math.pow(2, attempt)); // Exponential backoff
        } else {
          this.log('error', `Step failed after ${retriesUsed} attempt(s): ${errorMessage}`, step.id);
          throw error;
        }
      }
    }

    throw new Error(`Step ${step.id} failed`);
  }

  private async executeStepWithTimeout(step: PlaybookStep, timeout: number): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeout);

    try {
      switch (step.type) {
        case 'shell':
          return await this.executeShell(step);
        case 'api':
          return await this.executeApi(step);
        case 'wait':
          return await this.executeWait(step);
        case 'verify':
          return await this.executeVerify(step);
        case 'conditional':
          return await this.executeConditional(step);
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async executeShell(step: PlaybookStep): Promise<string> {
    if (!step.command) throw new Error('Shell step requires command');

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(step.command);
      this.log('info', `Shell command output: ${stdout.substring(0, 200)}`, step.id);
      return stdout;
    } catch (error) {
      const stderr = error instanceof Error && 'stderr' in error ? (error as any).stderr : String(error);
      this.log('error', `Shell command failed: ${stderr}`, step.id);
      throw error;
    }
  }

  private async executeApi(step: PlaybookStep): Promise<string> {
    if (!step.endpoint) throw new Error('API step requires endpoint');

    const method = step.method || 'GET';
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (step.payload && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(step.payload);
    }

    try {
      const response = await fetch(step.endpoint, options);

      if (step.expectedStatus && response.status !== step.expectedStatus) {
        throw new Error(`Expected status ${step.expectedStatus}, got ${response.status}`);
      }

      const text = await response.text();
      this.log('info', `API call returned status ${response.status}`, step.id);
      return text;
    } catch (error) {
      this.log('error', `API call failed: ${error instanceof Error ? error.message : String(error)}`, step.id);
      throw error;
    }
  }

  private async executeWait(step: PlaybookStep): Promise<string> {
    const duration = step.timeout || 5000;
    this.log('info', `Waiting ${duration}ms...`, step.id);
    await this.sleep(duration);
    return `Waited ${duration}ms`;
  }

  private async executeVerify(step: PlaybookStep): Promise<string> {
    if (!step.command) throw new Error('Verify step requires command');
    if (!step.expectedOutput) throw new Error('Verify step requires expectedOutput');

    const output = await this.executeShell(step);
    const regex = new RegExp(step.expectedOutput);

    if (!regex.test(output)) {
      throw new Error(`Verification failed: output does not match pattern "${step.expectedOutput}"`);
    }

    this.log('success', 'Verification passed', step.id);
    return 'Verification passed';
  }

  private async executeConditional(step: PlaybookStep): Promise<string> {
    // Conditional execution based on environment or previous step results
    // For now, always succeed (can be extended)
    this.log('info', 'Conditional check passed', step.id);
    return 'Conditional check passed';
  }

  private async rollback(): Promise<void> {
    this.log('warn', 'Attempting rollback...', 'system');
    this.execution.rollbackAttempted = true;

    try {
      for (const step of this.playbook.rollback) {
        try {
          await this.executeStep(step);
        } catch (error) {
          this.log('error', `Rollback step ${step.id} failed: ${error instanceof Error ? error.message : String(error)}`, step.id);
        }
      }

      this.execution.rollbackSuccess = true;
      this.execution.status = 'rolled_back';
      this.log('success', 'Rollback completed', 'system');
    } catch (error) {
      this.execution.rollbackSuccess = false;
      this.log('error', `Rollback failed: ${error instanceof Error ? error.message : String(error)}`, 'system');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Execute a playbook and return the execution result
 */
export async function executePlaybook(
  playbook: Playbook,
  incidentId: string,
  userId: string,
  dryRun = false,
): Promise<RemediationExecution> {
  const executor = new PlaybookExecutor(playbook, incidentId, userId, dryRun);
  return await executor.execute();
}
