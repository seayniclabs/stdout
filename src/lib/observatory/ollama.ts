/**
 * Ollama Integration for Observatory
 *
 * Handles communication with local Ollama instance running small ML models
 * (Llama 3.2 3B for Watcher, Qwen 2.5 14B for Analyst)
 */

import { AGENT_PERSONAS } from './agents';

export interface OllamaRequest {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  stream?: boolean;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Call Ollama API
 *
 * Connects to local Ollama instance at localhost:11434
 */
export async function callOllama(
  request: OllamaRequest,
  timeoutMs: number = 30000
): Promise<OllamaResponse> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        system: request.system,
        temperature: request.temperature ?? 0.3,
        stream: false, // Always use non-streaming for structured output
        options: {
          num_predict: 1024, // Max tokens
          stop: ['```\n\n', '\n\n\n'] // Stop on code block end or triple newline
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as OllamaResponse;
  } catch (error: any) {
    clearTimeout(timeout);

    if (error.name === 'AbortError') {
      throw new Error(`Ollama timeout after ${timeoutMs}ms`);
    }

    throw new Error(`Ollama API call failed: ${error.message}`);
  }
}

/**
 * Call Watcher agent (Llama 3.2 3B)
 *
 * Fast, efficient model for continuous monitoring
 */
export async function callWatcherModel(systemPrompt: string): Promise<string> {
  const model = AGENT_PERSONAS.watcher.model;

  const response = await callOllama({
    model,
    system: systemPrompt,
    prompt: 'Analyze the current metrics and baselines. Respond with JSON only.',
    temperature: 0.2 // Low temperature for consistent, conservative detection
  }, 15000); // 15s timeout (3B model is fast)

  return response.response;
}

/**
 * Call Analyst agent (Qwen 2.5 14B)
 *
 * Larger model for deeper incident investigation
 */
export async function callAnalystModel(systemPrompt: string): Promise<string> {
  const model = AGENT_PERSONAS.analyst.model;

  const response = await callOllama({
    model,
    system: systemPrompt,
    prompt: 'Investigate this incident and provide a diagnosis with recommended resolution. Respond with JSON only.',
    temperature: 0.4 // Slightly higher for more creative problem-solving
  }, 45000); // 45s timeout (14B model is slower)

  return response.response;
}

/**
 * Check if Ollama is available
 *
 * Returns true if Ollama is running and responsive
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get list of available models
 *
 * Returns models installed in Ollama
 */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

    const response = await fetch(`${ollamaUrl}/api/tags`);

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    return data.models?.map((m: any) => m.name) || [];
  } catch (error) {
    console.error('[Ollama] Failed to list models:', error);
    return [];
  }
}

/**
 * Check if required Observatory models are installed
 *
 * Returns { watcher: boolean, analyst: boolean }
 */
export async function checkRequiredModels(): Promise<{
  watcher: boolean;
  analyst: boolean;
  available: string[];
}> {
  const models = await listOllamaModels();

  const watcherModel = AGENT_PERSONAS.watcher.model;
  const analystModel = AGENT_PERSONAS.analyst.model;

  return {
    watcher: models.some(m => m.includes(watcherModel.split(':')[0])),
    analyst: models.some(m => m.includes(analystModel.split(':')[0])),
    available: models
  };
}

/**
 * Pull a model from Ollama registry
 *
 * This is a long-running operation (can take minutes for large models)
 */
export async function pullModel(modelName: string): Promise<void> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

  const response = await fetch(`${ollamaUrl}/api/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: modelName,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to pull model ${modelName}: ${response.statusText}`);
  }

  console.log(`[Ollama] Successfully pulled model: ${modelName}`);
}
