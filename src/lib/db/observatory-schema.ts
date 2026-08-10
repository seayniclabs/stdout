import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { users } from './schema';
import { incidents } from './monitoring-schema';

export const observatoryStandardPatterns = sqliteTable('observatory_standard_patterns', {
  id: text('id').primaryKey(),
  patternName: text('pattern_name').notNull(),
  category: text('category').notNull(),
  symptoms: text('symptoms').notNull(),
  commonCauses: text('common_causes').notNull(),
  resolutionSteps: text('resolution_steps').notNull(),
  preventionSteps: text('prevention_steps'),
  confidenceThreshold: real('confidence_threshold').notNull(),
  source: text('source').notNull().default('stdlib'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryCustomPatterns = sqliteTable('observatory_custom_patterns', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  pattern: text('pattern').notNull(),
  description: text('description').notNull(),
  suggestedCommands: text('suggested_commands'),
  preventionSteps: text('prevention_steps'),
  severity: text('severity', {
    enum: ['critical', 'high', 'medium', 'low'],
  }).notNull().default('medium'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryBaselines = sqliteTable('observatory_baselines', {
  id: text('id').primaryKey(),
  stackId: text('stack_id').notNull(),
  metricName: text('metric_name').notNull(),
  mean: real('mean').notNull(),
  stdDev: real('std_dev').notNull(),
  sampleCount: integer('sample_count').notNull(),
  windowStart: integer('window_start').notNull(),
  windowEnd: integer('window_end').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryAgentRuns = sqliteTable('observatory_agent_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  agentType: text('agent_type', {
    enum: ['watcher', 'analyst', 'executor'],
  }).notNull(),
  incidentId: text('incident_id'),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  outcome: text('outcome').notNull(),
  executionTimeMs: integer('execution_time_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryFeedback = sqliteTable('observatory_feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  incidentId: text('incident_id').notNull(),
  diagnosisId: text('diagnosis_id'),
  feedbackType: text('feedback_type', {
    enum: ['helpful', 'not_helpful', 'incorrect', 'missing_context'],
  }).notNull(),
  comment: text('comment'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const observatoryPendingFixes = sqliteTable('observatory_pending_fixes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  incidentId: text('incident_id').notNull(),
  fixType: text('fix_type').notNull(),
  fixCommand: text('fix_command').notNull(),
  riskLevel: text('risk_level', {
    enum: ['low', 'medium', 'high'],
  }).notNull().default('medium'),
  status: text('status', {
    enum: ['pending', 'approved', 'rejected', 'applied'],
  }).notNull().default('pending'),
  approvedBy: text('approved_by'),
  appliedAt: integer('applied_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const remediationPlaybooks = sqliteTable('remediation_playbooks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  trigger: text('trigger').notNull(), // JSON: { type, pattern }
  steps: text('steps').notNull(), // JSON array
  rollback: text('rollback').notNull(), // JSON array
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(false),
  timeout: integer('timeout').notNull(), // seconds
  riskLevel: text('risk_level', {
    enum: ['low', 'medium', 'high'],
  }).notNull().default('medium'),
  tags: text('tags').notNull().default('[]'), // JSON array
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
  version: text('version').notNull().default('1.0.0'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  createdBy: text('created_by'),
});

export const remediationExecutions = sqliteTable('remediation_executions', {
  id: text('id').primaryKey(),
  playbookId: text('playbook_id').notNull().references(() => remediationPlaybooks.id),
  incidentId: text('incident_id').notNull().references(() => incidents.id),
  userId: text('user_id').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'success', 'failed', 'rolled_back', 'cancelled'],
  }).notNull().default('pending'),
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  logs: text('logs').notNull().default('[]'), // JSON array of ExecutionLog
  rollbackAttempted: integer('rollback_attempted', { mode: 'boolean' }).notNull().default(false),
  rollbackSuccess: integer('rollback_success', { mode: 'boolean' }),
});

export const remediationExecutionSteps = sqliteTable('remediation_execution_steps', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull().references(() => remediationExecutions.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'success', 'failed', 'skipped', 'timeout'],
  }).notNull().default('pending'),
  output: text('output'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  retriesUsed: integer('retries_used').notNull().default(0),
  executedAt: integer('executed_at', { mode: 'timestamp' }),
});

