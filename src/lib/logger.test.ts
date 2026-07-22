/**
 * Unit tests for logger.ts
 *
 * Tests structured logging output, error handling, and best-effort wrapper
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger, bestEffort } from './logger';

describe('Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('createLogger', () => {
    it('should create a logger with module name', () => {
      const logger = createLogger('test-module');
      expect(logger).toHaveProperty('info');
      expect(logger).toHaveProperty('warn');
      expect(logger).toHaveProperty('error');
    });

    it('should log info messages with correct structure', () => {
      const logger = createLogger('test-module');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('level', 'INFO');
      expect(logged).toHaveProperty('module', 'test-module');
      expect(logged).toHaveProperty('timestamp');
      expect(logged).toHaveProperty('msg', 'Test message');
    });

    it('should log warn messages with correct structure', () => {
      const logger = createLogger('test-module');
      logger.warn('Warning message');

      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(consoleWarnSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('level', 'WARN');
      expect(logged).toHaveProperty('module', 'test-module');
      expect(logged).toHaveProperty('msg', 'Warning message');
    });

    it('should log error messages with correct structure', () => {
      const logger = createLogger('test-module');
      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('level', 'ERROR');
      expect(logged).toHaveProperty('module', 'test-module');
      expect(logged).toHaveProperty('msg', 'Error message');
    });

    it('should include timestamp in ISO format', () => {
      const logger = createLogger('test-module');
      const before = new Date().toISOString();
      logger.info('Test');
      const after = new Date().toISOString();

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const timestamp = new Date(logged.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime()
      );
      expect(timestamp.getTime()).toBeLessThanOrEqual(
        new Date(after).getTime()
      );
    });

    it('should include context data in log entry', () => {
      const logger = createLogger('test-module');
      logger.info('Test', { userId: 'user-123', action: 'login' });

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('userId', 'user-123');
      expect(logged).toHaveProperty('action', 'login');
      expect(logged).toHaveProperty('msg', 'Test');
    });

    it('should handle undefined context gracefully', () => {
      const logger = createLogger('test-module');
      logger.info('Test', undefined);

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('msg', 'Test');
    });

    it('should merge context fields into log entry', () => {
      const logger = createLogger('test-module');
      logger.info('Message', {
        field1: 'value1',
        field2: 123,
        field3: true,
        field4: null,
        field5: { nested: 'object' },
      });

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged.field1).toBe('value1');
      expect(logged.field2).toBe(123);
      expect(logged.field3).toBe(true);
      expect(logged.field4).toBe(null);
      expect(logged.field5).toEqual({ nested: 'object' });
    });
  });

  describe('Error logging with stack traces', () => {
    it('should include error message when Error is passed', () => {
      const logger = createLogger('test-module');
      const error = new Error('Something went wrong');
      logger.error('Operation failed', error);

      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('error', 'Something went wrong');
      expect(logged).toHaveProperty('stack');
    });

    it('should include stack trace for Error objects', () => {
      const logger = createLogger('test-module');
      const error = new Error('Test error');
      logger.error('Error occurred', error);

      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged.stack).toContain('Test error');
      expect(logged.stack).toContain('at');
    });

    it('should handle non-Error objects passed as error', () => {
      const logger = createLogger('test-module');
      logger.error('Error', 'string error');

      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('error', 'string error');
    });

    it('should handle null error by including it as string', () => {
      const logger = createLogger('test-module');
      logger.error('Message', null);

      expect(consoleErrorSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('msg', 'Message');
      // null is stringified to "null"
      expect(logged.error).toBe('null');
    });

    it('should handle undefined error gracefully', () => {
      const logger = createLogger('test-module');
      logger.error('Message', undefined);

      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged).not.toHaveProperty('error');
    });

    it('should include context with error information', () => {
      const logger = createLogger('test-module');
      const error = new Error('DB connection failed');
      logger.error('Database error', error, {
        database: 'prod-01',
        retries: 3,
      });

      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged).toHaveProperty('error', 'DB connection failed');
      expect(logged).toHaveProperty('database', 'prod-01');
      expect(logged).toHaveProperty('retries', 3);
    });

    it('should handle different Error types', () => {
      const logger = createLogger('test-module');

      const typeError = new TypeError('Type mismatch');
      logger.error('Type error', typeError);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('Type mismatch');

      const rangeError = new RangeError('Out of range');
      logger.error('Range error', rangeError);
      expect(consoleErrorSpy.mock.calls[1][0]).toContain('Out of range');
    });
  });

  describe('Module names', () => {
    it('should preserve module name exactly', () => {
      const modules = [
        'simple',
        'with-dash',
        'with_underscore',
        'UPPERCASE',
        'mixed-Case_123',
      ];

      for (const moduleName of modules) {
        consoleLogSpy.mockClear();
        const logger = createLogger(moduleName);
        logger.info('Test');

        const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
        expect(logged.module).toBe(moduleName);
      }
    });

    it('should handle empty module name', () => {
      const logger = createLogger('');
      logger.info('Test');

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged.module).toBe('');
    });

    it('should handle long module names', () => {
      const longName = 'a'.repeat(1000);
      const logger = createLogger(longName);
      logger.info('Test');

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged.module).toBe(longName);
    });
  });

  describe('Log levels', () => {
    it('should use correct log level for info', () => {
      const logger = createLogger('test');
      logger.info('Info message');

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged.level).toBe('INFO');
    });

    it('should use correct log level for warn', () => {
      const logger = createLogger('test');
      logger.warn('Warning message');

      const logged = JSON.parse(consoleWarnSpy.mock.calls[0][0]);
      expect(logged.level).toBe('WARN');
    });

    it('should use correct log level for error', () => {
      const logger = createLogger('test');
      logger.error('Error message');

      const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(logged.level).toBe('ERROR');
    });
  });

  describe('JSON output validation', () => {
    it('should produce valid JSON', () => {
      const logger = createLogger('test');
      logger.info('Test', { field: 'value' });

      expect(() => {
        JSON.parse(consoleLogSpy.mock.calls[0][0]);
      }).not.toThrow();
    });

    it('should handle special characters in messages', () => {
      const logger = createLogger('test');
      const specialMsg = 'Message with "quotes" and \\backslashes and \nnewlines';
      logger.info(specialMsg);

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged.msg).toBe(specialMsg);
    });

    it('should handle special characters in context', () => {
      const logger = createLogger('test');
      logger.info('Test', {
        path: 'C:\\Users\\Test\\File.txt',
        json: '{"key": "value"}',
        quote: 'She said "hello"',
      });

      const logged = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logged.path).toBe('C:\\Users\\Test\\File.txt');
      expect(logged.json).toBe('{"key": "value"}');
      expect(logged.quote).toBe('She said "hello"');
    });
  });

  describe('Multiple loggers', () => {
    it('should create independent loggers', () => {
      const logger1 = createLogger('module-1');
      const logger2 = createLogger('module-2');

      logger1.info('From module 1');
      logger2.info('From module 2');

      const log1 = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const log2 = JSON.parse(consoleLogSpy.mock.calls[1][0]);

      expect(log1.module).toBe('module-1');
      expect(log2.module).toBe('module-2');
    });
  });
});

describe('bestEffort helper', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('should return result when function succeeds', () => {
    const result = bestEffort('test', () => 'success');
    expect(result).toBe('success');
  });

  it('should return result when function succeeds with fallback available', () => {
    const result = bestEffort(
      'test',
      () => 'primary',
      () => 'fallback'
    );
    expect(result).toBe('primary');
  });

  it('should return fallback when function throws', () => {
    const result = bestEffort(
      'test',
      () => {
        throw new Error('Primary failed');
      },
      () => 'fallback'
    );
    expect(result).toBe('fallback');
  });

  it('should return undefined when no fallback and function throws', () => {
    const result = bestEffort('test', () => {
      throw new Error('Failed');
    });
    expect(result).toBeUndefined();
  });

  it('should log warning when function throws', () => {
    bestEffort('operation', () => {
      throw new Error('Something went wrong');
    });

    expect(consoleWarnSpy).toHaveBeenCalled();
    const logged = consoleWarnSpy.mock.calls[0][0];
    expect(logged).toContain('[best-effort]');
    expect(logged).toContain('operation');
    expect(logged).toContain('Something went wrong');
  });

  it('should log warning when fallback throws', () => {
    bestEffort(
      'test',
      () => {
        throw new Error('Primary failed');
      },
      () => {
        throw new Error('Fallback also failed');
      }
    );

    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    const secondWarning = consoleWarnSpy.mock.calls[1][0];
    expect(secondWarning).toContain('fallback also failed');
  });

  it('should include operation name in warning', () => {
    bestEffort('fetch-config', () => {
      throw new Error('Network error');
    });

    const logged = consoleWarnSpy.mock.calls[0][0];
    expect(logged).toContain('fetch-config');
  });

  it('should handle non-Error throws', () => {
    const result = bestEffort(
      'test',
      () => {
        throw 'string error';
      },
      () => 'fallback'
    );

    expect(result).toBe('fallback');
  });

  it('should handle various return types', () => {
    const stringResult = bestEffort('test', () => 'string');
    expect(stringResult).toBe('string');

    const numberResult = bestEffort('test', () => 42);
    expect(numberResult).toBe(42);

    const objectResult = bestEffort('test', () => ({ key: 'value' }));
    expect(objectResult).toEqual({ key: 'value' });

    const arrayResult = bestEffort('test', () => [1, 2, 3]);
    expect(arrayResult).toEqual([1, 2, 3]);

    const nullResult = bestEffort('test', () => null);
    expect(nullResult).toBeNull();
  });

  it('should handle synchronous operations', () => {
    const result = bestEffort('sync-op', () => {
      const a = 1;
      const b = 2;
      return a + b;
    });

    expect(result).toBe(3);
  });

  it('should preserve function return type', () => {
    interface User {
      id: number;
      name: string;
    }

    const user: User = { id: 1, name: 'John' };
    const result = bestEffort<User>('getUser', () => user);

    expect(result?.id).toBe(1);
    expect(result?.name).toBe('John');
  });

  it('should handle undefined fallback', () => {
    const result = bestEffort('test', () => 'success', undefined);
    expect(result).toBe('success');

    const result2 = bestEffort('test', () => {
      throw new Error('Failed');
    });
    expect(result2).toBeUndefined();
  });

  it('should be best-effort - never throws', () => {
    expect(() => {
      bestEffort('dangerous', () => {
        throw new Error('Catastrophic failure');
      });
    }).not.toThrow();

    expect(() => {
      bestEffort(
        'dangerous',
        () => {
          throw new Error('Primary failure');
        },
        () => {
          throw new Error('Fallback failure');
        }
      );
    }).not.toThrow();
  });
});
