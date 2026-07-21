/**
 * Structured Logging Utility
 *
 * Provides a simple structured logging interface with JSON output.
 * All log entries include timestamp, level, and module information.
 * Errors include stack traces automatically.
 */

export interface LogContext {
  module: string;
  userId?: string;
  traceId?: string;
  [key: string]: unknown;
}

export function createLogger(module: string) {
  return {
    info: (msg: string, ctx?: Omit<LogContext, 'module'>) => {
      const timestamp = new Date().toISOString();
      const logEntry = {
        level: 'INFO',
        module,
        timestamp,
        msg,
        ...(ctx || {}),
      };
      console.log(JSON.stringify(logEntry));
    },

    warn: (msg: string, ctx?: Omit<LogContext, 'module'>) => {
      const timestamp = new Date().toISOString();
      const logEntry = {
        level: 'WARN',
        module,
        timestamp,
        msg,
        ...(ctx || {}),
      };
      console.warn(JSON.stringify(logEntry));
    },

    error: (msg: string, err?: unknown, ctx?: Omit<LogContext, 'module'>) => {
      const timestamp = new Date().toISOString();
      const logEntry: Record<string, unknown> = {
        level: 'ERROR',
        module,
        timestamp,
        msg,
      };

      if (err instanceof Error) {
        logEntry.error = err.message;
        logEntry.stack = err.stack;
      } else if (err !== undefined) {
        logEntry.error = String(err);
      }

      if (ctx) {
        Object.assign(logEntry, ctx);
      }

      console.error(JSON.stringify(logEntry));
    },
  };
}

/**
 * Best-effort helper for non-critical operations.
 * Logs a warning if the function throws, otherwise returns the result.
 * Never throws; always returns T | undefined.
 *
 * Usage:
 *   const result = bestEffort('fetch-config', () => fetchConfig(), () => defaultConfig());
 */
export function bestEffort<T>(
  name: string,
  fn: () => T,
  fallback?: () => T,
): T | undefined {
  try {
    return fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[best-effort] ${name}: ${msg}`);
    if (fallback) {
      try {
        return fallback();
      } catch (fallbackErr) {
        console.warn(`[best-effort] ${name} fallback also failed: ${String(fallbackErr)}`);
      }
    }
    return undefined;
  }
}
