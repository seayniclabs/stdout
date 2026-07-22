/**
 * Unit tests for api-types.ts
 *
 * Tests type guards and validators for API responses
 */

import { describe, it, expect } from 'vitest';
import {
  isValidIncidentStatus,
  isValidIncidentSeverity,
  isValidMonitorType,
  isValidMonitorStatus,
  validateOllamaResponse,
  validateOpenAIResponse,
  validateAnthropicResponse,
} from './api-types';
import { apiResponses, invalidApiResponses } from './__tests__/fixtures';

describe('Type Guards', () => {
  describe('isValidIncidentStatus', () => {
    it('should validate correct status values', () => {
      expect(isValidIncidentStatus('active')).toBe(true);
      expect(isValidIncidentStatus('investigating')).toBe(true);
      expect(isValidIncidentStatus('monitoring')).toBe(true);
      expect(isValidIncidentStatus('resolved')).toBe(true);
    });

    it('should reject invalid status values', () => {
      expect(isValidIncidentStatus('unknown')).toBe(false);
      expect(isValidIncidentStatus('pending')).toBe(false);
      expect(isValidIncidentStatus('archived')).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(isValidIncidentStatus(123)).toBe(false);
      expect(isValidIncidentStatus(null)).toBe(false);
      expect(isValidIncidentStatus(undefined)).toBe(false);
      expect(isValidIncidentStatus({})).toBe(false);
      expect(isValidIncidentStatus([])).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isValidIncidentStatus('Active')).toBe(false);
      expect(isValidIncidentStatus('ACTIVE')).toBe(false);
    });
  });

  describe('isValidIncidentSeverity', () => {
    it('should validate correct severity values', () => {
      expect(isValidIncidentSeverity('critical')).toBe(true);
      expect(isValidIncidentSeverity('high')).toBe(true);
      expect(isValidIncidentSeverity('medium')).toBe(true);
      expect(isValidIncidentSeverity('low')).toBe(true);
    });

    it('should reject invalid severity values', () => {
      expect(isValidIncidentSeverity('extreme')).toBe(false);
      expect(isValidIncidentSeverity('minimal')).toBe(false);
      expect(isValidIncidentSeverity('info')).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(isValidIncidentSeverity(1)).toBe(false);
      expect(isValidIncidentSeverity(null)).toBe(false);
      expect(isValidIncidentSeverity(undefined)).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isValidIncidentSeverity('Critical')).toBe(false);
      expect(isValidIncidentSeverity('CRITICAL')).toBe(false);
    });
  });

  describe('isValidMonitorType', () => {
    it('should validate correct monitor types', () => {
      expect(isValidMonitorType('http')).toBe(true);
      expect(isValidMonitorType('tcp')).toBe(true);
      expect(isValidMonitorType('docker')).toBe(true);
      expect(isValidMonitorType('ping')).toBe(true);
      expect(isValidMonitorType('dns')).toBe(true);
      expect(isValidMonitorType('output-freshness')).toBe(true);
    });

    it('should reject invalid monitor types', () => {
      expect(isValidMonitorType('https')).toBe(false);
      expect(isValidMonitorType('kubernetes')).toBe(false);
      expect(isValidMonitorType('custom')).toBe(false);
      expect(isValidMonitorType('api')).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(isValidMonitorType(123)).toBe(false);
      expect(isValidMonitorType(null)).toBe(false);
      expect(isValidMonitorType(undefined)).toBe(false);
    });
  });

  describe('isValidMonitorStatus', () => {
    it('should validate correct monitor status values', () => {
      expect(isValidMonitorStatus('healthy')).toBe(true);
      expect(isValidMonitorStatus('degraded')).toBe(true);
      expect(isValidMonitorStatus('down')).toBe(true);
      expect(isValidMonitorStatus('maintenance')).toBe(true);
      expect(isValidMonitorStatus('unknown')).toBe(true);
    });

    it('should reject invalid status values', () => {
      expect(isValidMonitorStatus('up')).toBe(false);
      expect(isValidMonitorStatus('offline')).toBe(false);
      expect(isValidMonitorStatus('error')).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(isValidMonitorStatus(0)).toBe(false);
      expect(isValidMonitorStatus(null)).toBe(false);
      expect(isValidMonitorStatus(undefined)).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isValidMonitorStatus('Healthy')).toBe(false);
      expect(isValidMonitorStatus('HEALTHY')).toBe(false);
    });
  });
});

describe('API Response Validators', () => {
  describe('validateOllamaResponse', () => {
    it('should validate correct Ollama response', () => {
      const result = validateOllamaResponse(apiResponses.ollama);
      expect(result.response).toBe('The service is running correctly');
      expect(result.prompt_eval_count).toBe(150);
      expect(result.eval_count).toBe(50);
    });

    it('should handle missing optional fields', () => {
      const minimal = { response: 'Hello' };
      const result = validateOllamaResponse(minimal);
      expect(result.response).toBe('Hello');
      expect(result.prompt_eval_count).toBeUndefined();
      expect(result.eval_count).toBeUndefined();
    });

    it('should reject null', () => {
      expect(() => validateOllamaResponse(null)).toThrow('expected object');
    });

    it('should reject missing response field', () => {
      expect(() => validateOllamaResponse({})).toThrow(
        'missing or invalid response field'
      );
    });

    it('should reject non-string response field', () => {
      expect(() => validateOllamaResponse({ response: 123 })).toThrow(
        'missing or invalid response field'
      );
    });

    it('should reject non-object input', () => {
      expect(() => validateOllamaResponse('not-an-object')).toThrow(
        'expected object'
      );
      // Arrays are objects in JS, so they fail on missing response field instead
      expect(() => validateOllamaResponse([])).toThrow();
      expect(() => validateOllamaResponse(123)).toThrow('expected object');
    });

    it('should ignore invalid optional fields', () => {
      const data = {
        response: 'OK',
        prompt_eval_count: 'not-a-number',
        eval_count: null,
      };
      const result = validateOllamaResponse(data);
      expect(result.response).toBe('OK');
      expect(result.prompt_eval_count).toBeUndefined();
      expect(result.eval_count).toBeUndefined();
    });
  });

  describe('validateOpenAIResponse', () => {
    it('should validate correct OpenAI response', () => {
      const result = validateOpenAIResponse(apiResponses.openai);
      expect(result.choices.length).toBeGreaterThan(0);
      expect(result.choices[0].message.content).toBe(
        'The issue is a DNS resolution problem'
      );
      expect(result.usage?.prompt_tokens).toBe(200);
      expect(result.model).toBe('gpt-4o');
    });

    it('should handle missing optional fields', () => {
      const minimal = {
        choices: [
          {
            message: {
              content: 'Hello',
            },
          },
        ],
      };
      const result = validateOpenAIResponse(minimal);
      expect(result.choices[0].message.content).toBe('Hello');
      expect(result.usage).toBeUndefined();
      expect(result.model).toBeUndefined();
    });

    it('should reject null', () => {
      expect(() => validateOpenAIResponse(null)).toThrow('expected object');
    });

    it('should reject missing choices field', () => {
      expect(() => validateOpenAIResponse({})).toThrow(
        'missing or invalid choices field'
      );
    });

    it('should reject empty choices array', () => {
      expect(() => validateOpenAIResponse({ choices: [] })).toThrow(
        'empty choices array'
      );
    });

    it('should reject missing message in choice', () => {
      expect(() =>
        validateOpenAIResponse({
          choices: [{}],
        })
      ).toThrow('missing message in first choice');
    });

    it('should reject missing content in message', () => {
      expect(() =>
        validateOpenAIResponse({
          choices: [
            {
              message: {},
            },
          ],
        })
      ).toThrow('missing content in message');
    });

    it('should reject non-string content', () => {
      expect(() =>
        validateOpenAIResponse({
          choices: [
            {
              message: {
                content: 123,
              },
            },
          ],
        })
      ).toThrow('missing content in message');
    });

    it('should reject non-array choices', () => {
      expect(() =>
        validateOpenAIResponse({
          choices: 'not-an-array',
        })
      ).toThrow('missing or invalid choices field');
    });
  });

  describe('validateAnthropicResponse', () => {
    it('should validate correct Anthropic response', () => {
      const result = validateAnthropicResponse(apiResponses.anthropic);
      expect(result.id).toBe('msg-001');
      expect(result.model).toBe('claude-sonnet-4');
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.usage.input_tokens).toBe(250);
    });

    it('should handle missing id field', () => {
      expect(() =>
        validateAnthropicResponse({
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4',
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        })
      ).toThrow('missing id field');
    });

    it('should handle missing model field', () => {
      expect(() =>
        validateAnthropicResponse({
          id: 'msg-001',
          type: 'message',
          role: 'assistant',
          content: [],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        })
      ).toThrow('missing model field');
    });

    it('should handle missing content field', () => {
      expect(() =>
        validateAnthropicResponse({
          id: 'msg-001',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4',
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        })
      ).toThrow('missing or invalid content field');
    });

    it('should reject null', () => {
      expect(() => validateAnthropicResponse(null)).toThrow('expected object');
    });

    it('should handle missing optional fields with defaults', () => {
      const minimal = {
        id: 'msg-001',
        content: [],
        model: 'claude-sonnet-4',
      };
      const result = validateAnthropicResponse(minimal);
      expect(result.id).toBe('msg-001');
      expect(result.type).toBe('');
      expect(result.role).toBe('');
      expect(result.stop_reason).toBe('');
      expect(result.usage.input_tokens).toBe(0);
      expect(result.usage.output_tokens).toBe(0);
    });

    it('should accept content array with text type', () => {
      const response = {
        id: 'msg-001',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = validateAnthropicResponse(response);
      expect(result.content.length).toBe(2);
    });

    it('should accept content without text field', () => {
      const response = {
        id: 'msg-001',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
        model: 'claude-sonnet-4',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = validateAnthropicResponse(response);
      expect(result.content[0].text).toBeUndefined();
    });

    it('should preserve exact id string', () => {
      const id = 'msg-12345-special-chars_ABC';
      const response = {
        id,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4',
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      const result = validateAnthropicResponse(response);
      expect(result.id).toBe(id);
    });
  });

  describe('Invalid input handling', () => {
    it('should reject undefined input', () => {
      expect(() => validateOllamaResponse(undefined)).toThrow();
      expect(() => validateOpenAIResponse(undefined)).toThrow();
      expect(() => validateAnthropicResponse(undefined)).toThrow();
    });

    it('should reject array input', () => {
      expect(() => validateOllamaResponse([])).toThrow();
      expect(() => validateOpenAIResponse([])).toThrow();
      expect(() => validateAnthropicResponse([])).toThrow();
    });

    it('should reject number input', () => {
      expect(() => validateOllamaResponse(42)).toThrow();
      expect(() => validateOpenAIResponse(42)).toThrow();
      expect(() => validateAnthropicResponse(42)).toThrow();
    });

    it('should reject boolean input', () => {
      expect(() => validateOllamaResponse(true)).toThrow();
      expect(() => validateOpenAIResponse(false)).toThrow();
      expect(() => validateAnthropicResponse(true)).toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle deeply nested structures', () => {
      const response = {
        id: 'msg-001',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Response with special chars: { } [ ] " \\ / etc',
          },
        ],
        model: 'claude-sonnet-4',
        usage: { input_tokens: 100, output_tokens: 50 },
      };
      expect(() => validateAnthropicResponse(response)).not.toThrow();
    });

    it('should handle very long content', () => {
      const longContent = 'x'.repeat(10000);
      const response = {
        response: longContent,
      };
      const result = validateOllamaResponse(response);
      expect(result.response.length).toBe(10000);
    });

    it('should handle empty string content', () => {
      const response = {
        response: '',
      };
      const result = validateOllamaResponse(response);
      expect(result.response).toBe('');
    });

    it('should handle zero usage values', () => {
      const response = {
        choices: [
          {
            message: {
              content: 'Test',
            },
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
        },
      };
      const result = validateOpenAIResponse(response);
      expect(result.usage?.prompt_tokens).toBe(0);
      expect(result.usage?.completion_tokens).toBe(0);
    });
  });
});
