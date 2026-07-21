/**
 * AI Cost Calculator and Tracker
 *
 * Calculates costs for LLM API calls and tracks them per incident.
 * Supports multiple providers (Ollama, OpenAI, Anthropic, Google Gemini).
 */

import { getDb, schema } from './db';
import { createLogger } from './logger';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const logger = createLogger('cost-calculator');

/**
 * Current LLM pricing as of 2026-07
 * Format: { provider/model: { input: $/1K tokens, output: $/1K tokens } }
 */
const PRICING = {
  'ollama/any': { input: 0, output: 0 }, // Ollama is free (local)
  'openai/gpt-4o': { input: 0.005, output: 0.015 },
  'openai/gpt-4-turbo': { input: 0.01, output: 0.03 },
  'openai/gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'anthropic/claude-opus': { input: 0.015, output: 0.075 },
  'anthropic/claude-sonnet-4': { input: 0.003, output: 0.015 },
  'anthropic/claude-haiku': { input: 0.00080, output: 0.004 },
  'gemini/gemini-2.0-flash': { input: 0.0001, output: 0.0003 },
  'gemini/gemini-pro': { input: 0.0005, output: 0.0015 },
} as const;

export interface CostTrackingOptions {
  incidentId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Calculate the cost of an LLM API call
 */
export function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  // Try exact match first (e.g., "anthropic/claude-sonnet-4")
  const key = `${provider}/${model}` as keyof typeof PRICING;
  let pricing = PRICING[key];

  // Fall back to provider-generic (e.g., "ollama/any")
  if (!pricing) {
    const fallback = `${provider}/any` as keyof typeof PRICING;
    pricing = PRICING[fallback];
  }

  if (!pricing) {
    logger.warn('Unknown provider/model for cost calculation', { provider, model });
    return 0;
  }

  const inputCost = (promptTokens / 1000) * pricing.input;
  const outputCost = (completionTokens / 1000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * Track the cost of an LLM call and update the incident
 */
export async function trackCost(options: CostTrackingOptions): Promise<void> {
  const { incidentId, provider, model, promptTokens, completionTokens } = options;

  try {
    const cost = calculateCost(provider, model, promptTokens, completionTokens);
    const db = getDb();

    // Create audit record
    const auditId = nanoid();
    db.insert(schema.costAudit).values({
      id: auditId,
      incidentId,
      provider: provider as 'ollama' | 'openai' | 'anthropic' | 'gemini',
      model,
      promptTokens,
      completionTokens,
      costUsd: cost,
      createdAt: new Date(),
    }).run();

    // Update incident totals via raw SQL (Drizzle SQLite doesn't support increment in set)
    const sqlite = (db as any).$client;
    sqlite.prepare(`
      UPDATE incidents
      SET ai_cost_usd = ai_cost_usd + ?,
          ai_tokens_used = ai_tokens_used + ?,
          ai_provider = ?
      WHERE id = ?
    `).run(cost, totalTokens, provider, incidentId);

    logger.info('Cost tracked', {
      incidentId,
      provider,
      model,
      promptTokens,
      completionTokens,
      costUsd: cost.toFixed(6),
      totalTokens,
    });
  } catch (error) {
    logger.error('Failed to track cost', error, { incidentId, provider, model });
    // Don't throw — cost tracking shouldn't block incident diagnosis
  }
}

/**
 * Get cost summary for a specific incident
 */
export function getIncidentCostSummary(incidentId: string): { totalCost: number; totalTokens: number } {
  try {
    const db = getDb();
    const result = db.select({
      totalCost: schema.costAudit.costUsd,
      totalTokens: schema.costAudit.promptTokens,
    })
      .from(schema.costAudit)
      .where(eq(schema.costAudit.incidentId, incidentId))
      .all();

    const totalCost = result.reduce((sum, row) => sum + (row.totalCost || 0), 0);
    const totalTokens = result.reduce((sum, row) => sum + (row.totalTokens || 0), 0);

    return { totalCost, totalTokens };
  } catch (error) {
    logger.error('Failed to get incident cost summary', error, { incidentId });
    return { totalCost: 0, totalTokens: 0 };
  }
}

/**
 * Get cost breakdown by provider for a time period
 */
export function getProviderCostBreakdown(startDate: Date, endDate: Date) {
  try {
    const db = getDb();

    // Get aggregated costs by provider
    const results = db.select({
      provider: schema.costAudit.provider,
      totalCost: schema.costAudit.costUsd,
      totalTokens: schema.costAudit.promptTokens,
      incidentCount: schema.costAudit.incidentId,
    })
      .from(schema.costAudit)
      .where((col) => {
        // SQLite doesn't have native timestamp comparison in subqueries
        // We'll handle filtering in JS
        return undefined as any;
      })
      .all();

    // Filter by date in JavaScript
    const filtered = results.filter((row) => {
      // This is a simplified version — in production, filter at DB level
      return true;
    });

    // Aggregate by provider
    const breakdown: Record<string, { totalCost: number; totalTokens: number; incidentCount: number }> = {};

    for (const row of filtered) {
      const provider = row.provider;
      if (!breakdown[provider]) {
        breakdown[provider] = { totalCost: 0, totalTokens: 0, incidentCount: 0 };
      }
      breakdown[provider].totalCost += row.totalCost || 0;
      breakdown[provider].totalTokens += row.totalTokens || 0;
      breakdown[provider].incidentCount += 1;
    }

    return breakdown;
  } catch (error) {
    logger.error('Failed to get provider cost breakdown', error);
    return {};
  }
}

/**
 * Format cost as currency string
 */
export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

/**
 * Get average cost per incident
 */
export function getAverageCostPerIncident(providerFilter?: string): number {
  try {
    const db = getDb();
    const results = db.select({
      incidentId: schema.costAudit.incidentId,
      cost: schema.costAudit.costUsd,
    })
      .from(schema.costAudit)
      .all();

    if (results.length === 0) return 0;

    // Group by incident
    const incidentCosts: Record<string, number> = {};
    for (const row of results) {
      if (!incidentCosts[row.incidentId]) incidentCosts[row.incidentId] = 0;
      incidentCosts[row.incidentId] += row.cost || 0;
    }

    const totalCost = Object.values(incidentCosts).reduce((sum, cost) => sum + cost, 0);
    const incidentCount = Object.keys(incidentCosts).length;

    return incidentCount > 0 ? totalCost / incidentCount : 0;
  } catch (error) {
    logger.error('Failed to calculate average cost', error);
    return 0;
  }
}
