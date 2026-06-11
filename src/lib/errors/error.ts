/**
 * StdOutError Class
 *
 * Centralized error handling for the StdOut system.
 * All errors should be thrown as StdOutError instances with error codes from the catalog.
 */

import { ERROR_CATALOG } from './catalog';
import type { ErrorContext, UserErrorDisplay } from './types';

function generateCorrelationId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class StdOutError extends Error {
  public readonly code: string;
  public readonly category: string;
  public readonly severity: string;
  public readonly actions: string[];
  public readonly recoverable: boolean;
  public readonly retryable: boolean;
  public readonly context: ErrorContext;
  public readonly timestamp: string;
  public readonly correlationId: string;
  public readonly technicalDetail?: string;

  constructor(
    errorCode: string,
    context: ErrorContext = {},
    correlationId?: string
  ) {
    const definition = ERROR_CATALOG[errorCode];

    if (!definition) {
      // Fallback to E9999 for unknown errors
      const fallback = ERROR_CATALOG['E9999'];
      super(fallback.userMessage);
      this.code = 'E9999';
      this.category = fallback.category;
      this.severity = fallback.severity;
      this.actions = fallback.actions;
      this.recoverable = fallback.recoverable;
      this.retryable = fallback.retryable;
      this.context = { ...context, unknownErrorCode: errorCode };
      this.timestamp = new Date().toISOString();
      this.correlationId = correlationId || generateCorrelationId();
      return;
    }

    super(definition.userMessage);

    this.name = 'StdOutError';
    this.code = definition.code;
    this.category = definition.category;
    this.severity = definition.severity;
    this.actions = definition.actions;
    this.recoverable = definition.recoverable;
    this.retryable = definition.retryable;
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.correlationId = correlationId || generateCorrelationId();
    this.technicalDetail = definition.technicalDetail;
  }

  toJSON() {
    return {
      code: this.code,
      category: this.category,
      severity: this.severity,
      message: this.message,
      actions: this.actions,
      recoverable: this.recoverable,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
      technicalDetail: this.technicalDetail,
    };
  }

  toUserDisplay(): UserErrorDisplay {
    return {
      title: `Error ${this.code}`,
      message: this.message,
      severity: this.severity as any,
      actions: this.actions,
      support: this.recoverable
        ? 'Try the steps above, or contact support if the issue persists.'
        : `Contact support@seayniclabs.com with error code ${this.code}`,
    };
  }

  toString(): string {
    return `[${this.code}] ${this.message} (${this.correlationId})`;
  }
}
