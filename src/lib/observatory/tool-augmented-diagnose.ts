/**
 * Tool-augmented diagnosis (P7b — wiring the brain's hands into the diagnosis flow).
 *
 * Before the Analyst writes its diagnosis, give it a chance to RUN ONE read-only diagnostic tool
 * (dig/ping_sweep/packet_sample/trivy_image/zeek_analyze) and feed the real output back into the
 * diagnosis. This turns diagnosis from "reason from the description" into "reason from observed
 * evidence" — the eyes feeding the brain.
 *
 * Safety:
 *   - The selection pass only ever picks from the read-only tool manifest (gated/mutating excluded).
 *   - `runTool` re-validates args per-tool (the LLM supplies a target, never free-form argv) and we
 *     never pass allowGated, so a gated tool can't be invoked from this path.
 *   - The whole step is best-effort: any failure (no model, bad pick, tool error) just yields no
 *     extra context and diagnosis proceeds normally.
 *   - Mode-gated by the caller: diagnosis (and therefore this) only runs when effective mode ≥ diagnose.
 */

import { listTools, runTool } from './toolbox';

export interface ToolAugmentation {
  ran: boolean;
  tool?: string;
  args?: Record<string, unknown>;
  output?: string;
  exitCode?: number;
  /** A compact text block to append to the diagnosis context (empty if nothing ran). */
  contextBlock: string;
}

interface ToolPick {
  tool: string | null;
  args?: Record<string, unknown>;
  reason?: string;
}

/**
 * Ask the brain to pick at most one read-only tool, run it, and return a context block.
 * `credential` is the resolved diagnosis model (Ollama by default).
 */
export async function augmentWithTool(opts: {
  userId: string;
  incidentTitle: string;
  incidentDescription: string;
  credential: { provider: string; model: string; apiKey: string };
}): Promise<ToolAugmentation> {
  const none: ToolAugmentation = { ran: false, contextBlock: '' };

  console.log('[tool-augmented-diagnose] Starting tool augmentation for incident:', opts.incidentTitle.slice(0, 60));

  // Only offer read-only tools to the auto-selection path.
  const tools = listTools().filter((t) => t.safety === 'read-only');
  console.log(`[tool-augmented-diagnose] Found ${tools.length} read-only tools:`, tools.map(t => t.name).join(', '));
  if (tools.length === 0) {
    console.log('[tool-augmented-diagnose] No tools available, returning none');
    return none;
  }

  let pick: ToolPick | null = null;
  try {
    console.log('[tool-augmented-diagnose] Calling selectTool with credential:', opts.credential.provider, opts.credential.model);
    pick = await selectTool(opts.credential, opts.incidentTitle, opts.incidentDescription, tools);
    console.log('[tool-augmented-diagnose] selectTool returned:', pick);
  } catch (err) {
    console.error('[tool-augmented-diagnose] selectTool failed:', err);
    return none;
  }
  if (!pick || !pick.tool) {
    console.log('[tool-augmented-diagnose] No tool selected, returning none');
    return none;
  }

  // The pick must be a known read-only tool.
  if (!tools.some((t) => t.name === pick!.tool)) {
    console.warn(`[tool-augmented-diagnose] Selected tool "${pick.tool}" not in read-only list, rejecting`);
    return none;
  }

  console.log(`[tool-augmented-diagnose] Running tool: ${pick.tool} with args:`, pick.args);
  const result = await runTool({
    tool: pick.tool,
    args: pick.args || {},
    userId: opts.userId,
    reason: `diagnosis: ${pick.reason || 'evidence gathering'}`.slice(0, 200),
    // never allowGated from the diagnosis path
  });

  console.log(`[tool-augmented-diagnose] Tool execution result: ok=${result.ok}, exitCode=${result.exitCode}, stdout length=${result.stdout?.length || 0}`);

  if (!result.ok) {
    // Tool failed — still record that we tried, but no useful context.
    console.warn(`[tool-augmented-diagnose] Tool failed: ${result.error}`);
    return {
      ran: true,
      tool: pick.tool,
      args: pick.args,
      output: result.error,
      exitCode: result.exitCode,
      contextBlock: '',
    };
  }

  const out = (result.stdout || '').trim().slice(0, 4000);
  if (!out) {
    console.log('[tool-augmented-diagnose] Tool succeeded but no output, returning empty context');
    return { ran: true, tool: pick.tool, args: pick.args, output: '', exitCode: result.exitCode, contextBlock: '' };
  }

  const contextBlock =
    `\n\nLIVE DIAGNOSTIC EVIDENCE — the brain ran the read-only tool \`${pick.tool}\`` +
    `${pick.args && Object.keys(pick.args).length ? ` (${JSON.stringify(pick.args)})` : ''} and observed:\n` +
    '```\n' + out + '\n```\n' +
    'Use this real output as primary evidence when ranking root causes.';

  console.log(`[tool-augmented-diagnose] Success: tool ran, output length ${out.length}, context block created`);
  return { ran: true, tool: pick.tool, args: pick.args, output: out, exitCode: result.exitCode, contextBlock };
}

const SELECT_SYSTEM = (toolList: string) =>
  `You are triaging an incident and may run ONE read-only diagnostic tool to gather evidence before diagnosing. ` +
  `Pick the single most useful tool, or none if none would help.\n\nAVAILABLE READ-ONLY TOOLS:\n${toolList}\n\n` +
  `Respond JSON ONLY (no fences):\n` +
  `{"tool":"<tool name or null>","args":{...tool args...},"reason":"why this tool"}\n` +
  `Tool args by tool: dig→{"target":"<hostname>"}; ping_sweep→{"target":"<cidr or ip>"}; ` +
  `packet_sample→{"target":"<host>","count":50}; trivy_image→{"image":"<name:tag>"}; zeek_analyze→{}.\n` +
  `If no tool clearly helps, return {"tool":null}. Never invent a tool not listed.`;

async function selectTool(
  credential: { provider: string; model: string; apiKey: string },
  title: string,
  description: string,
  tools: Array<{ name: string; safety: string; description: string }>,
): Promise<ToolPick> {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  const system = SELECT_SYSTEM(toolList);
  const user = `Incident: ${title}\n\n${description}`;

  let text = '';
  if (credential.provider === 'ollama') {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credential.model, system, prompt: user, stream: false, format: 'json',
        options: { num_predict: 512 },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    text = ((await res.json()) as any).response || '';
  } else if (credential.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${credential.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credential.model, max_tokens: 512, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    text = ((await res.json()) as any).choices?.[0]?.message?.content || '';
  } else {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: credential.apiKey });
    const response = await client.messages.create({
      model: credential.model, max_tokens: 512,
      system: [{ type: 'text', text: system }],
      messages: [{ role: 'user', content: user }],
    });
    text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const parsed = JSON.parse(cleaned) as ToolPick;
  if (!parsed.tool || parsed.tool === 'null') return { tool: null };
  return { tool: String(parsed.tool), args: parsed.args || {}, reason: parsed.reason };
}
