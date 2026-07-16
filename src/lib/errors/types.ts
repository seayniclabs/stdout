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

/**
 * Helper to safely extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error instanceof Error ? error.message : String(error);
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error instanceof Error ? error.message : String(error));
  }
  return 'Unknown error';
}

/**
 * Helper to safely extract error stack from unknown error type
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return getErrorStack(error);
  return undefined;
}
