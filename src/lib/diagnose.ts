import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { getRigginsSystemPrompt } from './riggins/system-prompt';
import { diagnoseIncident as diagnoseWithRouter, analyzeLogs, parseNetworkDiscovery, generateRemediationScript } from './diagnose-with-router';

// Re-export router functions for easy migration
export { analyzeLogs, parseNetworkDiscovery, generateRemediationScript };

export function getAnthropicKey(): string | null {
  const keyPath = process.env.ANTHROPIC_API_KEY_FILE || '/run/secrets/anthropic_api_key';
  try {
    const key = readFileSync(keyPath, 'utf-8').trim();
    // Return null if file exists but is empty (Ollama-only deployment)
    if (!key) return null;
    return key;
  } catch {
    // Fall back to environment variable (local dev)
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    return null; // No platform key available — use Ollama
  }
}

let _client: Anthropic | null = null;
function getClient(apiKey?: string): Anthropic {
  if (apiKey) {
    // BYOK: create a fresh client with the user's key (don't cache)
    return new Anthropic({ apiKey });
  }
  const platformKey = getAnthropicKey();
  if (!platformKey) {
    throw new Error('No Anthropic API key available. Use Ollama provider or configure BYOK.');
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: platformKey });
  }
  return _client;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export interface DiagnosisResult {
  rootCauses: string[];
  suggestedCommands: string[];
  model: string;
  promptTokens: number;
  completionTokens: number;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // 429 = rate limited, 529 = overloaded, 5xx = server errors
    return err.status === 429 || err.status === 529 || err.status >= 500;
  }
  // Network errors (fetch failures, timeouts)
  if (err instanceof TypeError && err.message.includes('fetch')) return true;
  return false;
}

function getRetryDelay(err: unknown, attempt: number): number {
  // Respect Retry-After header if present (Anthropic sends this on 429)
  if (err instanceof Anthropic.APIError) {
    const retryAfter = err.headers?.['retry-after'];
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }
  // Exponential backoff: 1s, 2s, 4s + jitter
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * BASE_DELAY_MS * 0.5;
  return exponential + jitter;
}

async function callWithRetry(
  createMessage: () => Promise<Anthropic.Message>,
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await createMessage();
    } catch (err) {
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const delay = getRetryDelay(err, attempt);
      console.warn(`Anthropic API error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${Math.round(delay)}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

export interface DataSourceContext {
  type: string;
  name: string;
  enabled: boolean;
}

const DATA_SOURCE_DESCRIPTIONS: Record<string, string> = {
  influxdb: 'InfluxDB for time-series metrics collection and querying',
  prometheus: 'Prometheus for metrics scraping and alerting',
  trivy: 'Trivy for container vulnerability scanning',
  'uptime-kuma': 'Uptime Kuma for monitoring service availability and uptime',
  loki: 'Loki for centralized log aggregation and querying',
  graylog: 'Graylog for log management, analysis, and alerting',
  crowdsec: 'CrowdSec for collaborative intrusion detection and prevention',
  pihole: 'Pi-hole for DNS filtering, ad blocking, and DNS query analytics',
};

export async function diagnoseIncident(opts: {
  stackContext: string;
  incidentDescription: string;
  pastResolutions: string[];
  tier: 'free' | 'paid';
  dataSources?: DataSourceContext[];
  // BYOK overrides (optional — if not provided, uses platform key)
  apiKey?: string;
  model?: string;
  provider?: string;
}): Promise<DiagnosisResult> {
  // NEW: If no provider specified, use the LLM router (NVIDIA NIM code models)
  if (!opts.provider && !opts.apiKey) {
    return diagnoseWithRouter(opts);
  }

  // Legacy path: specific provider or BYOK
  const model = opts.model || (opts.tier === 'paid' ? 'claude-sonnet-4-6-20250514' : 'claude-haiku-4-5-20251001');

  const pastResolutionsBlock = opts.pastResolutions.length > 0
    ? `\n\nPast resolutions for similar incidents:\n${opts.pastResolutions.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : '';

  let dataSourcesBlock = '';
  if (opts.dataSources && opts.dataSources.length > 0) {
    const lines = opts.dataSources
      .filter((ds) => ds.enabled)
      .map((ds) => {
        const desc = DATA_SOURCE_DESCRIPTIONS[ds.type] || ds.type;
        return `- ${ds.name}: ${desc}`;
      });
    if (lines.length > 0) {
      dataSourcesBlock = `\n\nThe user has the following monitoring and security tools available:\n${lines.join('\n')}\nConsider what data from these tools might help diagnose the issue, and suggest relevant queries or commands.`;
    }
  }
  // Load Riggins's persistent system prompt
  const rigginsPrompt = getRigginsSystemPrompt();

  // Append task-specific diagnosis instructions
  const systemPrompt = `${rigginsPrompt}

## CURRENT TASK: Incident Diagnosis

The user runs the following stack:
${opts.stackContext}${pastResolutionsBlock}${dataSourcesBlock}

Respond with a JSON object containing:
- "rootCauses": array of strings, ranked by likelihood (most likely first). Each should be 1-2 sentences.
- "suggestedCommands": array of shell commands to run for diagnosis.

Respond ONLY with valid JSON, no markdown fences.`;

  const provider = opts.provider || 'anthropic';
  let text = '';
  let promptTokens = 0;
  let completionTokens = 0;

  if (provider === 'ollama') {
    // Local Ollama — the default model Seaynic provides (no key required).
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        prompt: opts.incidentDescription,
        stream: false,
        options: { num_predict: 2048 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json() as any;
    text = data.response || '';
    promptTokens = data.prompt_eval_count || 0;
    completionTokens = data.eval_count || 0;
  } else if (provider === 'openai') {
    // OpenAI Chat Completions API
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: opts.incidentDescription },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw Object.assign(new Error(`OpenAI API error: ${res.status}`), { status: res.status, body: err });
    }
    const data = await res.json() as any;
    text = data.choices?.[0]?.message?.content || '';
    promptTokens = data.usage?.prompt_tokens || 0;
    completionTokens = data.usage?.completion_tokens || 0;
  } else if (provider === 'gemini') {
    // Google Gemini API
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: opts.incidentDescription }] }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw Object.assign(new Error(`Gemini API error: ${res.status}`), { status: res.status, body: err });
    }
    const data = await res.json() as any;
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    promptTokens = data.usageMetadata?.promptTokenCount || 0;
    completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
  } else {
    // Anthropic (default) — uses SDK with retry logic
    const client = getClient(opts.apiKey);
    const response = await callWithRetry(() =>
      client.messages.create({
        model,
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          { role: 'user', content: opts.incidentDescription },
        ],
      })
    );
    text = response.content[0].type === 'text' ? response.content[0].text : '';
    promptTokens = response.usage.input_tokens;
    completionTokens = response.usage.output_tokens;
  }

  let parsed: { rootCauses: string[]; suggestedCommands: string[] };
  try {
    let jsonText = text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {
      rootCauses: [text],
      suggestedCommands: [],
    };
  }

  return {
    rootCauses: parsed.rootCauses || [],
    suggestedCommands: parsed.suggestedCommands || [],
    model,
    promptTokens,
    completionTokens,
  };
}
