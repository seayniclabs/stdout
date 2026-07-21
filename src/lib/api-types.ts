/**
 * Typed API Response Interfaces
 *
 * Strict type definitions and validators for all external API responses.
 * Prevents silent type coercion (`as any`) by validating at the boundary.
 */

export interface OllamaGenerateResponse {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
  load_duration?: number;
}

export interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model?: string;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text?: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Type guards for status enums
export function isValidIncidentStatus(
  status: unknown,
): status is 'active' | 'investigating' | 'monitoring' | 'resolved' {
  return (
    typeof status === 'string' &&
    ['active', 'investigating', 'monitoring', 'resolved'].includes(status)
  );
}

export function isValidIncidentSeverity(
  severity: unknown,
): severity is 'critical' | 'high' | 'medium' | 'low' {
  return (
    typeof severity === 'string' &&
    ['critical', 'high', 'medium', 'low'].includes(severity)
  );
}

export function isValidMonitorType(
  type: unknown,
): type is 'http' | 'tcp' | 'docker' | 'ping' | 'dns' | 'output-freshness' {
  return (
    typeof type === 'string' &&
    ['http', 'tcp', 'docker', 'ping', 'dns', 'output-freshness'].includes(type)
  );
}

export function isValidMonitorStatus(
  status: unknown,
): status is 'healthy' | 'degraded' | 'down' | 'maintenance' | 'unknown' {
  return (
    typeof status === 'string' &&
    ['healthy', 'degraded', 'down', 'maintenance', 'unknown'].includes(status)
  );
}

// Validators with proper error messages
export function validateOllamaResponse(data: unknown): OllamaGenerateResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid Ollama response: expected object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.response !== 'string') {
    throw new Error('Invalid Ollama response: missing or invalid response field');
  }

  return {
    response: obj.response,
    prompt_eval_count:
      typeof obj.prompt_eval_count === 'number' ? obj.prompt_eval_count : undefined,
    eval_count: typeof obj.eval_count === 'number' ? obj.eval_count : undefined,
    total_duration:
      typeof obj.total_duration === 'number' ? obj.total_duration : undefined,
    load_duration:
      typeof obj.load_duration === 'number' ? obj.load_duration : undefined,
  };
}

export function validateOpenAIResponse(data: unknown): OpenAIResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid OpenAI response: expected object');
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.choices)) {
    throw new Error('Invalid OpenAI response: missing or invalid choices field');
  }

  if (obj.choices.length === 0) {
    throw new Error('Invalid OpenAI response: empty choices array');
  }

  const firstChoice = obj.choices[0] as Record<string, unknown>;
  if (
    typeof firstChoice.message !== 'object' ||
    firstChoice.message === null
  ) {
    throw new Error('Invalid OpenAI response: missing message in first choice');
  }

  const message = firstChoice.message as Record<string, unknown>;
  if (typeof message.content !== 'string') {
    throw new Error('Invalid OpenAI response: missing content in message');
  }

  return {
    choices: obj.choices as OpenAIResponse['choices'],
    usage: (obj.usage as unknown) as OpenAIResponse['usage'] | undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
  };
}

export function validateAnthropicResponse(data: unknown): AnthropicResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid Anthropic response: expected object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string') {
    throw new Error('Invalid Anthropic response: missing id field');
  }

  if (!Array.isArray(obj.content)) {
    throw new Error('Invalid Anthropic response: missing or invalid content field');
  }

  if (typeof obj.model !== 'string') {
    throw new Error('Invalid Anthropic response: missing model field');
  }

  return {
    id: obj.id,
    type: (obj.type as string) || '',
    role: (obj.role as string) || '',
    content: (obj.content as AnthropicResponse['content']) || [],
    model: obj.model,
    stop_reason: (obj.stop_reason as string) || '',
    usage: (obj.usage as AnthropicResponse['usage']) || {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}
