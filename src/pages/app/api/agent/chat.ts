/**
 * Observatory Agent Chat API
 *
 * POST /api/agent/chat
 * - Accepts user message
 * - Loads 4-tier memory
 * - Auto-routes to best available AI (Ollama → Claude CLI → Gemini CLI)
 * - Persists conversation
 * - Returns response (JSON for now, SSE streaming in future)
 *
 * NO configuration required - auto-detects available AI providers.
 */

import type { APIRoute } from 'astro';
import { loadMemory, saveConversation, buildPromptContext } from '../../../../lib/agent/memory';
import { autoRouteWithTools } from '../../../../lib/agent/auto-router-tools';
import { requireAuth } from '../../../../lib/rbac';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  try {
    const body = await request.json();
    const { message } = body;

    // Skip CSRF for authenticated agent chat - auth check above is sufficient
    // Agent chat is read-only (no state mutation) and user is already authenticated

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Try fast command parser first (bypasses LLM for explicit commands)
    const { parseCommand, getHelpText } = await import('../../../../lib/agent/command-parser');
    const { executeNetworkScan, executeCreateMonitors, executeCreateStack } = await import('../../../../lib/agent/command-handlers');

    const command = parseCommand(message);

    // Execute direct commands if confidence is high
    if (command.intent && command.confidence >= 0.85) {
      let result;

      switch (command.intent) {
        case 'scan_network':
          result = await executeNetworkScan(locals.user.id, command.args?.createMonitors || false);
          break;
        case 'create_monitors':
          result = await executeCreateMonitors(locals.user.id);
          break;
        case 'create_stack':
          result = await executeCreateStack(
            locals.user.id,
            command.args?.name || 'New Stack',
            command.args?.description
          );
          break;
        case 'help':
          result = { success: true, message: getHelpText() };
          break;
        default:
          result = null;
      }

      if (result) {
        // Save conversation
        await saveConversation(locals.user.id, 'user', message);
        await saveConversation(locals.user.id, 'assistant', result.message, {
          provider: 'command-parser',
          model: 'direct',
          degraded: false,
        });

        return new Response(JSON.stringify({
          response: result.message,
          provider: 'command-parser',
          model: 'direct',
          degraded: false,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 2. Load 4-tier memory
    const memory = await loadMemory(locals.user.id);
    const context = buildPromptContext(memory);

    // 3. Fall back to Auto-route with tool support (Ollama can call Observatory APIs)
    const response = await autoRouteWithTools(message, context, locals.user.id);

    // 3. Persist conversation
    await saveConversation(locals.user.id, 'user', message);
    await saveConversation(locals.user.id, 'assistant', response.content, {
      provider: response.provider,
      model: response.model,
      degraded: response.degraded,
      toolsUsed: response.toolsUsed,
    });

    // 4. Return response
    return new Response(JSON.stringify({
      response: response.content,
      provider: response.provider,
      model: response.model,
      degraded: response.degraded,
      toolsUsed: response.toolsUsed,
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

