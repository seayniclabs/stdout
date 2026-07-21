/**
 * Cost Tracking API Endpoints
 * GET /api/costs - Get cost summary and breakdown
 */

import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { eq, sql, desc } from 'drizzle-orm';

interface CostSummary {
  totalCostThisMonth: number;
  totalTokensThisMonth: number;
  averageCostPerIncident: number;
  providerBreakdown: Record<string, {
    totalCost: number;
    totalTokens: number;
    incidentCount: number;
    avgCost: number;
  }>;
  recentIncidents: Array<{
    id: string;
    title: string;
    severity: string;
    aiCostUsd: number;
    aiTokensUsed: number;
    aiProvider: string;
    createdAt: Date;
  }>;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const userId = (request as any).userId;

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const db = getDb();

    // Get current month start
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get cost audit records for this month
    const costRecords = db.select({
      provider: schema.costAudit.provider,
      costUsd: schema.costAudit.costUsd,
      promptTokens: schema.costAudit.promptTokens,
      completionTokens: schema.costAudit.completionTokens,
      incidentId: schema.costAudit.incidentId,
    })
      .from(schema.costAudit)
      .where(sql`datetime(${schema.costAudit.createdAt}) >= ${monthStart.toISOString().split('T')[0]}`)
      .all();

    // Calculate totals
    let totalCostThisMonth = 0;
    let totalTokensThisMonth = 0;
    const providerMap: Record<string, {
      totalCost: number;
      totalTokens: number;
      incidents: Set<string>;
    }> = {};

    for (const record of costRecords) {
      totalCostThisMonth += record.costUsd || 0;
      totalTokensThisMonth += (record.promptTokens || 0) + (record.completionTokens || 0);

      const provider = record.provider;
      if (!providerMap[provider]) {
        providerMap[provider] = {
          totalCost: 0,
          totalTokens: 0,
          incidents: new Set(),
        };
      }
      providerMap[provider].totalCost += record.costUsd || 0;
      providerMap[provider].totalTokens += (record.promptTokens || 0) + (record.completionTokens || 0);
      providerMap[provider].incidents.add(record.incidentId);
    }

    // Get provider breakdown
    const providerBreakdown: Record<string, {
      totalCost: number;
      totalTokens: number;
      incidentCount: number;
      avgCost: number;
    }> = {};

    for (const [provider, data] of Object.entries(providerMap)) {
      const incidentCount = data.incidents.size;
      providerBreakdown[provider] = {
        totalCost: data.totalCost,
        totalTokens: data.totalTokens,
        incidentCount,
        avgCost: incidentCount > 0 ? data.totalCost / incidentCount : 0,
      };
    }

    // Get recent incidents with costs
    const recentIncidents = db.select({
      id: schema.incidents.id,
      title: schema.incidents.title,
      severity: schema.incidents.severity,
      aiCostUsd: schema.incidents.aiCostUsd,
      aiTokensUsed: schema.incidents.aiTokensUsed,
      aiProvider: schema.incidents.aiProvider,
      createdAt: schema.incidents.createdAt,
    })
      .from(schema.incidents)
      .where(eq(schema.incidents.userId, userId))
      .orderBy(desc(schema.incidents.createdAt))
      .limit(20)
      .all();

    // Calculate average cost per incident
    const incidentCount = recentIncidents.length;
    const averageCostPerIncident = incidentCount > 0
      ? recentIncidents.reduce((sum, i) => sum + (i.aiCostUsd || 0), 0) / incidentCount
      : 0;

    const response: CostSummary = {
      totalCostThisMonth,
      totalTokensThisMonth,
      averageCostPerIncident,
      providerBreakdown,
      recentIncidents: recentIncidents.map((i) => ({
        ...i,
        createdAt: i.createdAt instanceof Date ? i.createdAt : new Date(i.createdAt as number),
      })),
    };

    return new Response(JSON.stringify(response), { status: 200 });
  } catch (error) {
    console.error('Error fetching costs:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch costs' }), { status: 500 });
  }
};
