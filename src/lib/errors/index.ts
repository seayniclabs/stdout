/**
 * Error Handling Framework
 *
 * Centralized error handling for StdOut.
 */

export { StdOutError } from './error';
export { ERROR_CATALOG } from './catalog';
export { withRetry, autoRetry } from './retry';
export { logError, logEvent } from './logger';
export type {
  ErrorCategory,
  Severity,
  ErrorDefinition,
  ErrorContext,
  ErrorLogEntry,
  UserErrorDisplay,
} from './types';
