/**
 * Error Handling Framework Types
 *
 * Defines the structure for StdOut's centralized error handling system.
 */

export type ErrorCategory =
  | 'license'
  | 'docker'
  | 'database'
  | 'integration'
  | 'ai'
  | 'auth'
  | 'config'
  | 'scheduler'
  | 'monitoring'
  | 'backup'
  | 'github';

export type Severity = 'critical' | 'error' | 'warning' | 'info';

export type BackoffStrategy = 'linear' | 'exponential';

export interface RetryStrategy {
  maxAttempts: number; // -1 for infinite
  backoff: BackoffStrategy;
  delayMs: number;
}

export interface ErrorDefinition {
  code: string;
  category: ErrorCategory;
  severity: Severity;
  userMessage: string;
  technicalDetail?: string;
  actions: string[];
  recoverable: boolean;
  retryable: boolean;
  retryStrategy?: RetryStrategy;
  escalationPath?: string;
  relatedDocs?: string[];
  gracefulDegradation?: boolean;
}

export interface ErrorContext {
  [key: string]: any;
}

export interface ErrorLogEntry {
  timestamp: string;
  correlationId: string;
  code: string;
  category: string;
  severity: string;
  message: string;
  context: ErrorContext;
  stack?: string;
}

export interface UserErrorDisplay {
  title: string;
  message: string;
  severity: Severity;
  actions: string[];
  support: string;
}
