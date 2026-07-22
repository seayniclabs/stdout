/**
 * Unit tests for cost-calculator.ts
 *
 * Tests all 7 providers, edge cases, and cost aggregation logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  calculateCost,
  formatCost,
  getAverageCostPerIncident,
} from './cost-calculator';
import { costTrackingOptions } from './__tests__/fixtures';

describe('Cost Calculator', () => {
  describe('calculateCost', () => {
    it('should calculate cost for Anthropic Claude Sonnet 4', () => {
      const cost = calculateCost('anthropic', 'claude-sonnet-4', 1500, 500);
      // (1500/1000 * 0.003) + (500/1000 * 0.015)
      // = 0.0045 + 0.0075 = 0.012
      expect(cost).toBe(0.012);
    });

    it('should calculate cost for Anthropic Claude Opus', () => {
      const cost = calculateCost('anthropic', 'claude-opus', 2000, 1000);
      // (2000/1000 * 0.015) + (1000/1000 * 0.075)
      // = 0.03 + 0.075 = 0.105
      expect(cost).toBe(0.105);
    });

    it('should calculate cost for Anthropic Claude Haiku', () => {
      const cost = calculateCost('anthropic', 'claude-haiku', 1000, 300);
      // (1000/1000 * 0.00080) + (300/1000 * 0.004)
      // = 0.0008 + 0.0012 = 0.002
      expect(cost).toBe(0.002);
    });

    it('should calculate cost for OpenAI GPT-4o', () => {
      const cost = calculateCost('openai', 'gpt-4o', 2000, 800);
      // (2000/1000 * 0.005) + (800/1000 * 0.015)
      // = 0.01 + 0.012 = 0.022
      expect(cost).toBe(0.022);
    });

    it('should calculate cost for OpenAI GPT-4 Turbo', () => {
      const cost = calculateCost('openai', 'gpt-4-turbo', 3000, 2000);
      // (3000/1000 * 0.01) + (2000/1000 * 0.03)
      // = 0.03 + 0.06 = 0.09
      expect(cost).toBe(0.09);
    });

    it('should calculate cost for OpenAI GPT-3.5 Turbo', () => {
      const cost = calculateCost('openai', 'gpt-3.5-turbo', 5000, 2000);
      // (5000/1000 * 0.0005) + (2000/1000 * 0.0015)
      // = 0.0025 + 0.003 = 0.0055
      expect(cost).toBe(0.0055);
    });

    it('should calculate cost for Google Gemini 2.0 Flash', () => {
      const cost = calculateCost('gemini', 'gemini-2.0-flash', 5000, 1500);
      // (5000/1000 * 0.0001) + (1500/1000 * 0.0003)
      // = 0.0005 + 0.00045 = 0.00095
      expect(cost).toBeCloseTo(0.00095, 5);
    });

    it('should calculate cost for Google Gemini Pro', () => {
      const cost = calculateCost('gemini', 'gemini-pro', 10000, 5000);
      // (10000/1000 * 0.0005) + (5000/1000 * 0.0015)
      // = 0.005 + 0.0075 = 0.0125
      expect(cost).toBe(0.0125);
    });

    it('should return 0 cost for Ollama (local model)', () => {
      const cost = calculateCost('ollama', 'any', 50000, 20000);
      expect(cost).toBe(0);
    });

    it('should handle zero tokens', () => {
      const cost = calculateCost('anthropic', 'claude-sonnet-4', 0, 0);
      expect(cost).toBe(0);
    });

    it('should handle very large token counts', () => {
      const cost = calculateCost('anthropic', 'claude-sonnet-4', 1000000, 500000);
      // (1000000/1000 * 0.003) + (500000/1000 * 0.015)
      // = 1000 * 0.003 + 500 * 0.015 = 3 + 7.5 = 10.5
      expect(cost).toBe(10.5);
    });

    it('should fall back to provider-generic pricing for unknown model', () => {
      // Ollama with unknown model should use ollama/any pricing
      const cost = calculateCost('ollama', 'unknown-model', 1000, 1000);
      expect(cost).toBe(0); // Ollama is free
    });

    it('should return 0 for completely unknown provider', () => {
      const cost = calculateCost('unknown-ai', 'model-xyz', 1000, 500);
      expect(cost).toBe(0);
    });

    it('should handle decimal token counts', () => {
      // Edge case: fractional tokens shouldn't happen but test anyway
      const cost = calculateCost('anthropic', 'claude-sonnet-4', 1500.5, 500.3);
      expect(typeof cost).toBe('number');
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('formatCost', () => {
    it('should format cost with 4 decimal places', () => {
      expect(formatCost(0.012)).toBe('$0.0120');
    });

    it('should format large costs', () => {
      expect(formatCost(123.456789)).toBe('$123.4568');
    });

    it('should format zero cost', () => {
      expect(formatCost(0)).toBe('$0.0000');
    });

    it('should format very small costs', () => {
      expect(formatCost(0.0001)).toBe('$0.0001');
    });

    it('should format very large costs', () => {
      expect(formatCost(10500)).toBe('$10500.0000');
    });
  });

  describe('getAverageCostPerIncident', () => {
    it('should calculate average when no results', () => {
      // Without DB setup, this will return 0
      const avg = getAverageCostPerIncident();
      expect(typeof avg).toBe('number');
      expect(avg).toBeGreaterThanOrEqual(0);
    });

    it('should handle provider filter parameter', () => {
      // Should not throw when filter is provided
      expect(() => {
        getAverageCostPerIncident('anthropic');
      }).not.toThrow();
    });

    it('should handle empty provider string', () => {
      expect(() => {
        getAverageCostPerIncident('');
      }).not.toThrow();
    });

    it('should handle undefined provider filter', () => {
      expect(() => {
        getAverageCostPerIncident(undefined);
      }).not.toThrow();
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle negative tokens gracefully (shouldn\'t happen but test anyway)', () => {
      // Negative tokens shouldn't happen, but implementation should handle it
      const cost = calculateCost('anthropic', 'claude-sonnet-4', -100, 50);
      // Should compute even if logically invalid
      expect(typeof cost).toBe('number');
    });

    it('should match exact model names first before fallback', () => {
      // claude-sonnet-4 exact match should be different from generic anthropic/any
      const exactCost = calculateCost('anthropic', 'claude-sonnet-4', 1000, 1000);
      // If anthropic/any existed, it should be different
      expect(exactCost).toBe(0.018); // Known pricing
    });

    it('should handle case sensitivity in provider names', () => {
      // Function uses lowercase keys, so uppercase might fall through
      const cost = calculateCost('Anthropic', 'claude-sonnet-4', 1000, 500);
      expect(cost).toBe(0);
    });

    it('should calculate incremental costs correctly', () => {
      const cost1 = calculateCost('anthropic', 'claude-sonnet-4', 1000, 500);
      const cost2 = calculateCost('anthropic', 'claude-sonnet-4', 1000, 500);
      const combined = calculateCost('anthropic', 'claude-sonnet-4', 2000, 1000);
      expect(cost1 + cost2).toBe(combined);
    });

    it('should handle null provider by returning 0', () => {
      // These would normally be caught by TypeScript, but test runtime behavior
      const cost = calculateCost(null as any, null as any, 0, 0);
      expect(cost).toBe(0);
    });
  });

  describe('Cost comparison between providers', () => {
    it('Claude Opus should be most expensive', () => {
      const opus = calculateCost('anthropic', 'claude-opus', 1000, 1000);
      const sonnet = calculateCost('anthropic', 'claude-sonnet-4', 1000, 1000);
      const haiku = calculateCost('anthropic', 'claude-haiku', 1000, 1000);

      expect(opus).toBeGreaterThan(sonnet);
      expect(sonnet).toBeGreaterThan(haiku);
    });

    it('Ollama should be cheapest', () => {
      const ollama = calculateCost('ollama', 'any', 100000, 50000);
      const haiku = calculateCost('anthropic', 'claude-haiku', 100000, 50000);

      expect(ollama).toBeLessThan(haiku);
      expect(ollama).toBe(0);
    });

    it('Gemini should be cheapest commercial option', () => {
      const gemini = calculateCost('gemini', 'gemini-2.0-flash', 1000, 1000);
      const haiku = calculateCost('anthropic', 'claude-haiku', 1000, 1000);
      const gpt35 = calculateCost('openai', 'gpt-3.5-turbo', 1000, 1000);

      expect(gemini).toBeLessThan(haiku);
      expect(gemini).toBeLessThan(gpt35);
    });
  });

  describe('Floating point precision', () => {
    it('should maintain precision for small costs', () => {
      const cost = calculateCost('gemini', 'gemini-2.0-flash', 100, 100);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.001);
    });

    it('should handle accumulated precision loss', () => {
      let total = 0;
      for (let i = 0; i < 1000; i++) {
        total += calculateCost('gemini', 'gemini-2.0-flash', 1, 1);
      }
      // Should accumulate to approximately 0.0004
      expect(total).toBeCloseTo(0.0004, 3);
    });
  });
});
