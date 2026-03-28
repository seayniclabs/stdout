import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

function getAnthropicKey(): string {
  const keyPath = process.env.ANTHROPIC_API_KEY_FILE || '/run/secrets/anthropic_api_key';
  try {
    return readFileSync(keyPath, 'utf-8').trim();
  } catch {
    // Fall back to environment variable (local dev)
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    throw new Error(`Anthropic API key not found at ${keyPath} and ANTHROPIC_API_KEY env var not set`);
  }
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getAnthropicKey() });
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
}): Promise<DiagnosisResult> {
  const model = opts.tier === 'paid' ? 'claude-sonnet-4-5-20250929' : 'claude-haiku-4-5-20251001';

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

  const response = await callWithRetry(() =>
    getClient().messages.create({
      model,
      max_tokens: 1024,
      system: `You are an incident diagnosis assistant. The user runs the following stack:\n${opts.stackContext}${pastResolutionsBlock}${dataSourcesBlock}\n\nRespond with a JSON object containing:\n- "rootCauses": array of strings, ranked by likelihood (most likely first). Each should be 1-2 sentences.\n- "suggestedCommands": array of shell commands to run for diagnosis.\n\nRespond ONLY with valid JSON, no markdown fences.`,
      messages: [
        { role: 'user', content: opts.incidentDescription },
      ],
    })
  );

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  let parsed: { rootCauses: string[]; suggestedCommands: string[] };
  try {
    // Strip markdown code fences if present (models sometimes add them despite instructions)
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
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
  };
}
