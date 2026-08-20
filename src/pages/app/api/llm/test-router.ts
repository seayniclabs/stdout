/**
 * Test endpoint for LLM router
 * GET /app/api/llm/test-router?task=log_analysis
 */
import type { APIRoute } from 'astro';
import { queryLLM, type TaskType } from '../../../../lib/llm/router';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = new URL(request.url);
    const taskType = (url.searchParams.get('task') || 'log_analysis') as TaskType;

    const testPrompt = `Test prompt for ${taskType}: Parse this nginx log line:
[2026-08-20 20:30:15] ERROR Connection refused (111: Connection refused)`;

    const result = await queryLLM({
      taskType,
      prompt: testPrompt,
      maxTokens: 100,
    });

    return new Response(JSON.stringify({
      success: true,
      taskType,
      modelUsed: result.modelUsed,
      providerId: result.providerId,
      response: result.content.substring(0, 200) + '...',
      tokensUsed: result.tokensUsed,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      error: error.message || 'LLM query failed',
      stack: error.stack,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
