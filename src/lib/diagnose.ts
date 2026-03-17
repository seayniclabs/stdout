import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export interface DiagnosisResult {
  rootCauses: string[];
  suggestedCommands: string[];
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export async function diagnoseIncident(opts: {
  stackContext: string;
  incidentDescription: string;
  pastResolutions: string[];
  tier: 'free' | 'paid';
}): Promise<DiagnosisResult> {
  const model = opts.tier === 'paid' ? 'claude-sonnet-4-5-20250514' : 'claude-haiku-4-5-20251001';

  const pastResolutionsBlock = opts.pastResolutions.length > 0
    ? `\n\nPast resolutions for similar incidents:\n${opts.pastResolutions.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : '';

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: `You are an incident diagnosis assistant. The user runs the following stack:\n${opts.stackContext}${pastResolutionsBlock}\n\nRespond with a JSON object containing:\n- "rootCauses": array of strings, ranked by likelihood (most likely first). Each should be 1-2 sentences.\n- "suggestedCommands": array of shell commands to run for diagnosis.\n\nRespond ONLY with valid JSON, no markdown fences.`,
    messages: [
      { role: 'user', content: opts.incidentDescription },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  let parsed: { rootCauses: string[]; suggestedCommands: string[] };
  try {
    parsed = JSON.parse(text);
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
