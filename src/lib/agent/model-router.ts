/**
 * Observatory Agent Model Router
 *
 * Handles routing to different AI providers based on customer configuration.
 * Supports: Ollama (local), Anthropic (CLI/API), Gemini, OpenAI, Custom endpoints.
 *
 * Gracefully degrades when models can't handle complex queries.
 */

import type { AgentConfig } from './types';

export interface RoutingContext {
  prompt: string;
  memory: Memory;
  tools: Tool[];
  userId: string;
}

export interface Memory {
  identity: string;
  context: string;
  conversations: Array<{ role: string; content: string }>;
  working: Map<string, any>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any) => Promise<any>;
}

export interface ModelResponse {
  content: string;
  toolCalls?: Array<{ tool: string; params: any; result: any }>;
  model: string;
  tokens?: { prompt: number; completion: number };
  degraded?: boolean; // True if model couldn't fully handle the request
}

export class ModelRouter {
  constructor(private config: AgentConfig) {}

  async route(context: RoutingContext): Promise<ModelResponse> {
    switch (this.config.provider) {
      case 'ollama':
        return this.routeOllama(context);
      case 'anthropic-cli':
        return this.routeAnthropicCLI(context);
      case 'anthropic-api':
        return this.routeAnthropicAPI(context);
      case 'gemini':
        return this.routeGemini(context);
      case 'openai':
        return this.routeOpenAI(context);
      case 'custom':
        return this.routeCustom(context);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  private async routeOllama(context: RoutingContext): Promise<ModelResponse> {
    const endpoint = this.config.endpoint || 'http://localhost:11434';

    // Build prompt with memory context
    const fullPrompt = this.buildPrompt(context);

    try {
      const response = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: fullPrompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      const data = await response.json();

      // Check if response indicates model limitations
      const degraded = this.detectDegradation(data.response);

      return {
        content: data.response,
        model: this.config.model,
        degraded,
      };
    } catch (error) {
      // Ollama unreachable - return graceful error
      return {
        content: `⚠️ I'm unable to process requests right now. Ollama at ${endpoint} is unreachable.\n\nYou can still use Observatory directly via the dashboard.`,
        model: this.config.model,
        degraded: true,
      };
    }
  }

  private async routeAnthropicCLI(context: RoutingContext): Promise<ModelResponse> {
    const fullPrompt = this.buildPrompt(context);

    // Use claude CLI (already installed on StdOut hosts)
    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
      const proc = spawn('claude', [
        '--model', this.config.model,
        '-p', fullPrompt,
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({
            content: `⚠️ Claude CLI error: ${stderr || 'Unknown error'}`,
            model: this.config.model,
            degraded: true,
          });
        } else {
          resolve({
            content: stdout.trim(),
            model: this.config.model,
            degraded: false,
          });
        }
      });
    });
  }

  private async routeAnthropicAPI(context: RoutingContext): Promise<ModelResponse> {
    if (!this.config.apiKey) {
      return {
        content: '⚠️ Anthropic API key not configured. Visit Settings → AI Configuration.',
        model: this.config.model,
        degraded: true,
      };
    }

    const fullPrompt = this.buildPrompt(context);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4096,
          messages: [
            { role: 'user', content: fullPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        content: data.content[0].text,
        model: this.config.model,
        tokens: {
          prompt: data.usage.input_tokens,
          completion: data.usage.output_tokens,
        },
        degraded: false,
      };
    } catch (error) {
      return {
        content: `⚠️ Anthropic API error: ${error instanceof Error ? error.message : String(error)}`,
        model: this.config.model,
        degraded: true,
      };
    }
  }

  private async routeGemini(context: RoutingContext): Promise<ModelResponse> {
    // TODO: Implement Gemini API routing
    return {
      content: '⚠️ Gemini provider not yet implemented',
      model: this.config.model,
      degraded: true,
    };
  }

  private async routeOpenAI(context: RoutingContext): Promise<ModelResponse> {
    // TODO: Implement OpenAI API routing
    return {
      content: '⚠️ OpenAI provider not yet implemented',
      model: this.config.model,
      degraded: true,
    };
  }

  private async routeCustom(context: RoutingContext): Promise<ModelResponse> {
    // TODO: Implement custom endpoint routing (OpenAI-compatible API)
    return {
      content: '⚠️ Custom provider not yet implemented',
      model: this.config.model,
      degraded: true,
    };
  }

  private buildPrompt(context: RoutingContext): string {
    const { memory, prompt } = context;

    // Build system + context + history + current prompt
    let fullPrompt = memory.identity + '\n\n';
    fullPrompt += '## Your Context\n' + memory.context + '\n\n';

    if (memory.conversations.length > 0) {
      fullPrompt += '## Recent Conversation History\n';
      for (const msg of memory.conversations) {
        fullPrompt += `${msg.role === 'user' ? 'User' : 'You'}: ${msg.content}\n`;
      }
      fullPrompt += '\n';
    }

    fullPrompt += '## Current Request\n' + prompt;

    return fullPrompt;
  }

  private detectDegradation(response: string): boolean {
    // Detect phrases that indicate model limitations
    const degradationPhrases = [
      "I don't have access",
      "I cannot",
      "I'm not able to",
      "my training data",
      "I don't know",
      "I'm uncertain",
      "I lack the capability",
    ];

    const lower = response.toLowerCase();
    return degradationPhrases.some((phrase) => lower.includes(phrase));
  }
}
