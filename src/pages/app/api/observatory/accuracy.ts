/**
 * Riggins suggestion accuracy — GET /app/api/observatory/accuracy?days=30
 *
 * Computes accepted/rejected/modified counts and accuracy% from `observatory_feedback`
 * over a rolling window, closing the blueprint §H gap: the Phase 1 exit gate checked
 * for 1+ incidents but never measured whether Riggins' suggestions were any good.
 */
import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/rbac';

export const GET: APIRoute = async ({ locals, url }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  try {
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    const { getObservatoryAccuracy } = await import('../../../../lib/observatory/pattern-feedback');
    const report = getObservatoryAccuracy(Number.isFinite(days) && days > 0 ? days : 30);

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[Observatory Accuracy API] Error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to compute accuracy',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
