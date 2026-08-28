/**
 * LLM Router - Multi-provider model routing
 *
 * Routes LLM requests to the best available model based on task type,
 * provider/model priority, and enabled status.
 *
 * Supports:
 * - NVIDIA NIM (free tier code models)
 * - Ollama (local privacy-first models)
 * - OpenAI / Anthropic (BYOK optional)
 * - Custom OpenAI-compatible APIs
 */

import { getDb } from '../db';
import { llmProviders, llmModels, llmTaskRouting } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const db = getDb();

export type TaskType =
  | 'log_analysis'
  | 'network_discovery'
  | 'incident_diagnosis'
  | 'script_generation'
  | 'config_parsing'
  | 'sanitization'
  | 'user_explanation'
  | 'strategic_decision';

export interface LLMRequest {
  taskType: TaskType;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  modelUsed: string;
  providerId: string;
  tokensUsed?: number;
}

/**
 * Select the best model for a given task type based on:
 * 1. Task routing preferences
 * 2. Provider/model enabled status
 * 3. Priority ordering
 */
async function selectModel(taskType: TaskType): Promise<{ provider: any; model: any } | null> {
  // Get task routing config
  const routing = await db
    .select()
    .from(llmTaskRouting)
    .where(and(eq(llmTaskRouting.taskType, taskType), eq(llmTaskRouting.enabled, true)))
    .get();

  if (!routing) {
    // No routing config, use highest priority enabled model
    return getHighestPriorityModel();
  }

  // Try preferred model first
  if (routing.preferredModelId) {
    const preferred = await getModelWithProvider(routing.preferredModelId);
    if (preferred && preferred.model.enabled && preferred.provider.enabled) {
      return preferred;
    }
  }

  // Try fallback models
  if (routing.fallbackModelIds) {
    const fallbacks = JSON.parse(routing.fallbackModelIds) as string[];
    for (const modelId of fallbacks) {
      const fallback = await getModelWithProvider(modelId);
      if (fallback && fallback.model.enabled && fallback.provider.enabled) {
        return fallback;
      }
    }
  }

  // Last resort: any enabled model
  return getHighestPriorityModel();
}

async function getModelWithProvider(modelId: string) {
  const model = await db.select().from(llmModels).where(eq(llmModels.id, modelId)).get();
  if (!model) return null;

  const provider = await db
    .select()
    .from(llmProviders)
    .where(eq(llmProviders.id, model.providerId))
    .get();
  if (!provider) return null;

  return { model, provider };
}

async function getHighestPriorityModel() {
  // Get all enabled models ordered by priority
  const allModels = await db
    .select()
    .from(llmModels)
    .where(eq(llmModels.enabled, true))
    .orderBy(llmModels.priority)
    .all();

  for (const model of allModels) {
    const provider = await db
      .select()
      .from(llmProviders)
      .where(and(eq(llmProviders.id, model.providerId), eq(llmProviders.enabled, true)))
      .get();

    if (provider) {
      return { model, provider };
    }
  }

  return null;
}

/**
 * Make an LLM request routed to the best available model
 */
export async function queryLLM(request: LLMRequest): Promise<LLMResponse> {
  const selected = await selectModel(request.taskType);

  if (!selected) {
    throw new Error('No enabled LLM models available');
  }

  const { provider, model } = selected;

  // Route to appropriate provider
  switch (provider.providerType) {
    case 'nvidia':
      return queryNVIDIA(provider, model, request);
    case 'ollama':
      return queryOllama(provider, model, request);
    case 'openai':
    case 'anthropic':
    case 'custom':
      return queryGenericOpenAI(provider, model, request);
    default:
      throw new Error(`Unknown provider type: ${provider.providerType}`);
  }
}

async function queryNVIDIA(provider: any, model: any, request: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env.NVIDIA_API_KEY || decryptApiKey(provider.apiKeyEncrypted);
  if (!apiKey) {
    throw new Error('NVIDIA API key not configured');
  }

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.modelId,
      messages: [{ role: 'user', content: request.prompt }],
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2000,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`NVIDIA API error: ${response.status} ${error}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices[0].message.content,
    modelUsed: model.displayName,
    providerId: provider.id,
    tokensUsed: data.usage?.total_tokens,
  };
}

async function queryOllama(provider: any, model: any, request: LLMRequest): Promise<LLMResponse> {
  const baseUrl = provider.baseUrl || 'http://localhost:11434';

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.modelId,
      prompt: request.prompt,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 2000,
      },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama error: ${response.status} ${error}`);
  }

  const data = await response.json() as any;
  return {
    content: data.response,
    modelUsed: model.displayName,
    providerId: provider.id,
  };
}

async function queryGenericOpenAI(provider: any, model: any, request: LLMRequest): Promise<LLMResponse> {
  const apiKey = decryptApiKey(provider.apiKeyEncrypted);
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider.name}`);
  }

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.modelId,
      messages: [{ role: 'user', content: request.prompt }],
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2000,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} ${error}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices[0].message.content,
    modelUsed: model.displayName,
    providerId: provider.id,
    tokensUsed: data.usage?.total_tokens,
  };
}

function decryptApiKey(encrypted: string | null): string | null {
  if (!encrypted) return null;

  // Single-instance mode: API keys stored in plaintext in database
  // Multi-instance would require proper encryption with a secret key
  // For self-hosted single-instance deployment, database file security is sufficient
  return encrypted;
}
