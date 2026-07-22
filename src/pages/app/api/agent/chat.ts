/**
 * Observatory Agent Chat API
 *
 * POST /api/agent/chat
 * - Accepts user message
 * - Loads 4-tier memory
 * - Routes to configured AI provider
 * - Persists conversation
 * - Returns response (JSON for now, SSE streaming in future)
 */

import type { APIRoute } from 'astro';
import { loadMemory, saveConversation } from '../../../../lib/agent/memory';
import { ModelRouter } from '../../../../lib/agent/model-router';
import { getSqlite } from '../../../../lib/db';
import type { AgentConfig } from '../../../../lib/agent/types';

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Load agent configuration
    const config = await getAgentConfig(user.id);
    if (!config) {
      return new Response(JSON.stringify({
        error: 'No AI provider configured',
        suggestion: 'Visit Settings → AI Configuration to enable Observatory Agent',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!config.enabled) {
      return new Response(JSON.stringify({
        error: 'Observatory Agent is disabled',
        suggestion: 'Enable it in Settings → AI Configuration',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Load 4-tier memory
    const memory = await loadMemory(user.id);

    // 3. Route through ModelRouter
    const router = new ModelRouter(config);
    const response = await router.route({
      prompt: message,
      memory,
      tools: [], // TODO: Add Observatory tools
      userId: user.id,
    });

    // 4. Persist conversation
    await saveConversation(user.id, 'user', message);
    await saveConversation(user.id, 'assistant', response.content, {
      model: response.model,
      tokens: response.tokens,
      degraded: response.degraded,
      toolCalls: response.toolCalls,
    });

    // 5. Return response
    return new Response(JSON.stringify({
      response: response.content,
      model: response.model,
      degraded: response.degraded,
      tokens: response.tokens,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Agent chat error:', error);

    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * Get agent configuration for user
 */
async function getAgentConfig(userId: string): Promise<AgentConfig | null> {
  const central = getSqlite();

  const row = central.prepare(`
    SELECT *
    FROM agent_config
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    endpoint: row.endpoint,
    model: row.model,
    apiKey: row.api_key,
    enabled: Boolean(row.enabled),
    proactiveNotifications: Boolean(row.proactive_notifications),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
