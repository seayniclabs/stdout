/**
 * Observatory Agent Configuration API
 *
 * GET /api/agent/config - Get current config
 * POST /api/agent/config - Save/update config
 * DELETE /api/agent/config - Disable agent
 */

import type { APIRoute } from 'astro';
import { getSqlite } from '../../../../lib/db';
import type { AgentConfig } from '../../../../lib/agent/types';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const config = await getAgentConfig(user.id);

    if (!config) {
      return new Response(JSON.stringify({
        configured: false,
        message: 'No AI provider configured',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Don't expose API key in response
    const safeConfig = {
      ...config,
      apiKey: config.apiKey ? '***' : undefined,
    };

    return new Response(JSON.stringify({
      configured: true,
      config: safeConfig,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Get agent config error:', error);

    return new Response(JSON.stringify({
      error: 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.provider || !body.model) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: provider, model',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate provider
    const validProviders = ['ollama', 'anthropic-cli', 'anthropic-api', 'gemini', 'openai', 'custom'];
    if (!validProviders.includes(body.provider)) {
      return new Response(JSON.stringify({
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Save configuration
    const config = await upsertAgentConfig(user.id, {
      provider: body.provider,
      endpoint: body.endpoint,
      model: body.model,
      apiKey: body.apiKey,
      enabled: body.enabled !== false, // Default to true
      proactiveNotifications: body.proactiveNotifications || false,
    });

    return new Response(JSON.stringify({
      success: true,
      config: {
        ...config,
        apiKey: config.apiKey ? '***' : undefined,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Save agent config error:', error);

    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ locals }) => {
  const user = locals.user;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const central = getSqlite();

    central.prepare(`
      UPDATE agent_config
      SET enabled = 0, updated_at = ?
      WHERE user_id = ?
    `).run(Date.now(), user.id);

    return new Response(JSON.stringify({
      success: true,
      message: 'Observatory Agent disabled',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Disable agent error:', error);

    return new Response(JSON.stringify({
      error: 'Internal server error',
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
    agentName: row.agent_name || 'Riggins',
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

/**
 * Create or update agent configuration
 */
async function upsertAgentConfig(
  userId: string,
  data: {
    agentName: string;
    provider: string;
    endpoint?: string;
    model: string;
    apiKey?: string;
    enabled: boolean;
    proactiveNotifications: boolean;
  }
): Promise<AgentConfig> {
  const central = getSqlite();
  const now = Date.now();

  // Check if config exists
  const existing = await getAgentConfig(userId);

  if (existing) {
    // Update existing
    central.prepare(`
      UPDATE agent_config
      SET agent_name = ?, provider = ?, endpoint = ?, model = ?, api_key = ?, enabled = ?, proactive_notifications = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.agentName || 'Riggins',
      data.provider,
      data.endpoint || null,
      data.model,
      data.apiKey || null,
      data.enabled ? 1 : 0,
      data.proactiveNotifications ? 1 : 0,
      now,
      existing.id
    );

    return {
      ...existing,
      ...data,
      updatedAt: new Date(now),
    };
  } else {
    // Create new
    const id = `agcfg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    central.prepare(`
      INSERT INTO agent_config (id, user_id, agent_name, provider, endpoint, model, api_key, enabled, proactive_notifications, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      data.agentName || 'Riggins',
      data.provider,
      data.endpoint || null,
      data.model,
      data.apiKey || null,
      data.enabled ? 1 : 0,
      data.proactiveNotifications ? 1 : 0,
      now,
      now
    );

    return {
      id,
      userId,
      ...data,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }
}
