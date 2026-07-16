/**
 * Error Logging
 *
 * Centralized error logging with support for structured logs and database storage.
 */

import { StdOutError } from './error';
import type { ErrorLogEntry } from './types';

export function logError(error: StdOutError, additionalContext?: Record<string, unknown>): void {
  const logEntry: ErrorLogEntry = {
    timestamp: error.timestamp,
    correlationId: error.correlationId,
    code: error.code,
    category: error.category,
    severity: error.severity,
    message: error instanceof Error ? error.message : String(error),
    context: { ...error.context, ...additionalContext },
    stack: getErrorStack(error),
  };

  // Console log (JSON for structured logging)
  console.error(JSON.stringify(logEntry));

  // Critical errors get immediate attention
  if (error.severity === 'critical') {
    alertCriticalError(logEntry);
  }

  // Store in database for analytics
  storeErrorLog(logEntry).catch((err) => {
    console.error('[Error Logger] Failed to store error log:', err);
  });
}

async function storeErrorLog(logEntry: ErrorLogEntry): Promise<void> {
  // Database write implementation
  // This will be implemented when we integrate with the database layer
  // For now, just log to console
  if (typeof window === 'undefined') {
    // Server-side only
    try {
      // TODO: Integrate with database
      // const db = getDatabase();
      // await db.run(`
      //   INSERT INTO error_log (timestamp, correlation_id, code, category, severity, message, context)
      //   VALUES (?, ?, ?, ?, ?, ?, ?)
      // `, [
      //   logEntry.timestamp,
      //   logEntry.correlationId,
      //   logEntry.code,
      //   logEntry.category,
      //   logEntry.severity,
      //   logEntry.message,
      //   JSON.stringify(logEntry.context),
      // ]);
    } catch (err) {
      console.error('[Error Logger] Database write failed:', err);
    }
  }
}

function alertCriticalError(logEntry: ErrorLogEntry): void {
  // For self-hosted: log to console with emphasis
  console.error('⚠️  CRITICAL ERROR ⚠️');
  console.error(JSON.stringify(logEntry, null, 2));

  // For SaaS: send to alerting service
  // TODO: Integrate with alerting (Sentry, Slack, email)
}

/**
 * Log a non-error event (info, warning)
 */
export function logEvent(
  code: string,
  message: string,
  context?: any
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    code,
    message,
    context,
  };

  console.log(JSON.stringify(logEntry));
}
