/**
 * Retry Logic
 *
 * Automatic retry handling for retryable errors.
 */

import { ERROR_CATALOG } from './catalog';
import { StdOutError } from './error';
import type { ErrorContext } from './types';

export async function withRetry<T>(
  fn: () => Promise<T>,
  errorCode: string,
  context: ErrorContext = {}
): Promise<T> {
  const definition = ERROR_CATALOG[errorCode];

  if (!definition) {
    throw new Error(`Unknown error code: ${errorCode}`);
  }

  if (!definition.retryable || !definition.retryStrategy) {
    return fn();
  }

  const { maxAttempts, backoff, delayMs } = definition.retryStrategy;
  let attempt = 0;

  while (maxAttempts === -1 || attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      attempt++;

      if (maxAttempts !== -1 && attempt >= maxAttempts) {
        throw new StdOutError(errorCode, {
          ...context,
          attempts: attempt,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }

      const delay =
        backoff === 'exponential'
          ? delayMs * Math.pow(2, attempt - 1)
          : delayMs * attempt;

      console.log(
        `[Retry] ${errorCode} - attempt ${attempt}/${maxAttempts === -1 ? '∞' : maxAttempts}, waiting ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // TypeScript exhaustiveness check
  throw new Error('Retry loop exited unexpectedly');
}

/**
 * Wrap a function with automatic retry based on thrown StdOutError codes
 */
export async function autoRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StdOutError && err.retryable) {
      const definition = ERROR_CATALOG[err.code];
      if (definition?.retryStrategy) {
        return withRetry(fn, err.code, err.context);
      }
    }
    throw err;
  }
}
