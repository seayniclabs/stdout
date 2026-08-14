/**
 * Enhanced diagnosis with tool calling for knowledge base access
 * 
 * This wraps the standard diagnose function and adds tool calling support
 * for Riggins to autonomously read markdown documentation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicKey } from "./diagnose";
import { getRigginsSystemPrompt } from "./riggins/system-prompt";
import { RIGGINS_TOOLS, executeRigginsTool } from "./riggins/ai-tools";

export interface DiagnosisWithToolsOptions {
  incidentDescription: string;
  stackContext: string;
  pastResolutions?: string;
  dataSources?: string;
  provider?: "anthropic" | "ollama" | "openai" | "gemini";
  model?: string;
  apiKey?: string;
}

export interface DiagnosisResult {
  rootCauses: string[];
  suggestedCommands: string[];
  toolsUsed: string[];
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Diagnose with tool calling (Anthropic only for now)
 * Falls back to standard diagnose for other providers
 */
export async function diagnoseWithTools(opts: DiagnosisWithToolsOptions): Promise<DiagnosisResult> {
  const provider = opts.provider || "anthropic";
  
  // Only Anthropic supports tool calling with our current setup
  if (provider !== "anthropic") {
    const { diagnoseWithAI } = await import("./diagnose");
    const result = await diagnoseWithAI(opts);
    return { ...result, toolsUsed: [] };
  }

  const apiKey = opts.apiKey || getAnthropicKey();
  if (!apiKey) {
    throw new Error("No Anthropic API key available");
  }

  const client = new Anthropic({ apiKey });
  const model = opts.model || "claude-3-5-sonnet-20241022";

  // Build system prompt
  const rigginsPrompt = getRigginsSystemPrompt();
  const pastResolutionsBlock = opts.pastResolutions ? `\n\nPast resolutions:\n${opts.pastResolutions}` : "";
  const dataSourcesBlock = opts.dataSources ? `\n\nData sources available:\n${opts.dataSources}` : "";

  const systemPrompt = `${rigginsPrompt}

## CURRENT TASK: Incident Diagnosis

The user runs the following stack:
${opts.stackContext}${pastResolutionsBlock}${dataSourcesBlock}

You have access to tools to read the knowledge base. Use them to:
1. Search for similar past incidents
2. Check relevant runbooks
3. Find troubleshooting guides

After using tools, respond with a JSON object containing:
- "rootCauses": array of strings, ranked by likelihood (most likely first). Each should be 1-2 sentences.
- "suggestedCommands": array of shell commands to run for diagnosis.

Respond ONLY with valid JSON, no markdown fences.`;

  // Tool calling loop
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: opts.incidentDescription },
  ];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const toolsUsed: string[] = [];
  let finalText = "";

  const MAX_TURNS = 5;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: RIGGINS_TOOLS,
      messages,
    });

    totalPromptTokens += response.usage.input_tokens;
    totalCompletionTokens += response.usage.output_tokens;

    // Check stop reason
    if (response.stop_reason === "end_turn") {
      // AI finished, extract final text
      const textContent = response.content.find((c) => c.type === "text");
      if (textContent && textContent.type === "text") {
        finalText = textContent.text;
      }
      break;
    }

    if (response.stop_reason === "tool_use") {
      // AI wants to use tools
      const toolUseBlocks = response.content.filter((c) => c.type === "tool_use");
      
      // Execute each tool call
      const toolResults: Anthropic.MessageParam["content"] = [];
      for (const block of toolUseBlocks) {
        if (block.type === "tool_use") {
          toolsUsed.push(block.name);
          console.log(`[diagnose-tools] Executing tool: ${block.name}`);
          
          try {
            const result = await executeRigginsTool(block.name, block.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
              is_error: true,
            });
          }
        }
      }

      // Add assistant message + tool results to conversation
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      
      continue; // Next turn
    }

    // Max iterations or unexpected stop reason
    break;
  }

  // Parse final JSON response
  let parsed: { rootCauses: string[]; suggestedCommands: string[] };
  try {
    // Strip markdown fences if present
    const cleaned = finalText.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback if JSON parsing fails
    parsed = {
      rootCauses: ["Unable to determine root cause from AI response"],
      suggestedCommands: [],
    };
  }

  return {
    rootCauses: parsed.rootCauses || [],
    suggestedCommands: parsed.suggestedCommands || [],
    toolsUsed,
    model,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
  };
}
