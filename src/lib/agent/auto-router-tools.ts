/**
 * Observatory Agent Auto-Router with Tool Support
 *
 * Handles tool calling for agents that support it (Ollama qwen2.5, Claude, Gemini).
 * Routes to providers that support tool use, executes tools, returns final response.
 */

import { OBSERVATORY_TOOLS, executeTool, type Tool } from './tools';

export interface AgentResponse {
  content: string;
  provider: string;
  model: string;
  degraded: boolean;
  toolsUsed?: string[];
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Auto-route with tool support
 */
export async function autoRouteWithTools(
  userMessage: string,
  context: string,
  userId: string
): Promise<AgentResponse> {
  // Try Ollama with tool calling (qwen2.5 supports tools)
  const ollamaResult = await tryOllamaWithTools(userMessage, context, userId);
  if (ollamaResult) return ollamaResult;

  // Fallback to simple text generation (no tools)
  const { autoRoute } = await import('./auto-router');
  return autoRoute(userMessage, context);
}

/**
 * Try Ollama with tool calling support
 */
async function tryOllamaWithTools(
  userMessage: string,
  context: string,
  userId: string
): Promise<AgentResponse | null> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = 'qwen2.5:14b-instruct-q4_K_M';

  try {
    const messages: Message[] = [
      { role: 'system', content: context },
      { role: 'user', content: userMessage },
    ];

    const toolsUsed: string[] = [];
    let finalResponse = '';
    let iterations = 0;
    const MAX_ITERATIONS = 5; // Prevent infinite tool loops

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          tools: OBSERVATORY_TOOLS.map(ollamaToolFormat),
          stream: false,
        }),
        signal: AbortSignal.timeout(180000), // 3 minutes for slow hardware (qwen2.5:14b @ 6.2 t/s)
      });

      if (!response.ok) {
        console.warn('[agent-auto-router-tools] Ollama returned', response.status);
        return null;
      }

      const data = await response.json();
      const assistantMessage = data.message;

      // If model wants to call a tool
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Add assistant's tool call message to history
        messages.push(assistantMessage);

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments;

          toolsUsed.push(toolName);

          const toolResult = await executeTool(toolName, toolArgs, userId);

          // Add tool result to messages
          messages.push({
            role: 'assistant', // Ollama expects tool results as assistant messages
            content: JSON.stringify({
              tool_call_id: toolCall.id,
              result: toolResult.success ? toolResult.result : { error: toolResult.error },
            }),
          });
        }

        // Continue loop to get model's response with tool results
        continue;
      }

      // No more tools to call - this is the final response
      finalResponse = assistantMessage.content || '';
      break;
    }

    if (!finalResponse) {
      console.warn('[agent-auto-router-tools] No final response after tool loop');
      return null;
    }

    return {
      content: finalResponse,
      provider: 'ollama',
      model,
      degraded: false,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
  } catch (error) {
    console.warn('[agent-auto-router-tools] Ollama tools failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Convert our tool format to Ollama's format
 */
function ollamaToolFormat(tool: Tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
