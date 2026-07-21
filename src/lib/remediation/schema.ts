/**
 * Auto-Remediation Playbook Schema
 *
 * Defines the type interfaces for playbooks, steps, and executions.
 * Playbooks are versioned bundles of remediation steps with rollback capabilities.
 */

/**
 * Trigger condition for a playbook
 */
export interface PlaybookTrigger {
  type: 'incident_fingerprint' | 'keyword' | 'stack_type' | 'severity';
  pattern: string; // regex or exact match
}

/**
 * Individual step in a playbook
 */
export interface PlaybookStep {
  id: string;
  type: 'shell' | 'api' | 'wait' | 'verify' | 'conditional';
  description: string;
  command?: string; // For shell steps
  endpoint?: string; // For API steps
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  payload?: Record<string, unknown>;
  expectedStatus?: number;
  expectedOutput?: string; // For verify steps (regex)
  timeout?: number; // milliseconds
  retries?: number;
  continueOnError?: boolean; // If true, execution continues even if step fails
}

/**
 * Complete playbook definition
 */
export interface Playbook {
  id: string;
  name: string;
  description: string;
  trigger: PlaybookTrigger;
  steps: PlaybookStep[];
  rollback: PlaybookStep[]; // Steps to undo changes if execution fails
  requiresApproval: boolean;
  timeout: number; // seconds
  riskLevel: 'low' | 'medium' | 'high'; // Helps determine if approval is needed
  tags: string[]; // e.g., ['k8s', 'pod-restart', 'auto-remediation']
  isBuiltIn: boolean; // true for system playbooks
  version: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
}

/**
 * Execution record for a playbook
 */
export interface RemediationExecution {
  id: string;
  playbookId: string;
  incidentId: string;
  userId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'rolled_back' | 'cancelled';
  dryRun: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  startedAt: Date;
  completedAt?: Date;
  logs: ExecutionLog[];
  rollbackAttempted?: boolean;
  rollbackSuccess?: boolean;
}

/**
 * Individual log entry during execution
 */
export interface ExecutionLog {
  timestamp: Date;
  stepId: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Step execution result
 */
export interface StepExecutionResult {
  stepId: string;
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  output?: string;
  errorMessage?: string;
  durationMs: number;
  retriesUsed: number;
}
