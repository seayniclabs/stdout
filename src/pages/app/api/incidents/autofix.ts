import type { APIRoute } from 'astro';
import { getTenantDb, tenantSchema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * POST /app/api/incidents/autofix
 * Actions: plan, patch, apply
 *
 * Auto-fix requires a BYOK user key — never uses platform key.
 * Generates remediation plans, file patches, and applies approved fixes.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { incidentId, action } = body;
  if (!incidentId || !action) {
    return new Response(JSON.stringify({ error: 'incidentId and action are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getTenantDb(userId);

  // Fetch incident
  const incident = db.select().from(tenantSchema.incidents)
    .where(eq(tenantSchema.incidents.id, incidentId)).get();
  if (!incident || incident.userId !== locals.user.id) {
    return new Response(JSON.stringify({ error: 'Incident not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auto-fix requires user key — never platform fallback
  const {
    resolveForDiagnostics,
    canUseAutofix,
    logAudit: logProviderAudit,
    isSelfHosted,
  } = await import('../../../../lib/ai-providers');

  if (!isSelfHosted()) {
    return new Response(JSON.stringify({ error: 'Auto-fix is available on self-hosted instances only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Find a user key that supports autofix
  const credential = resolveForDiagnostics(userId, 'paid');
  if (!credential || credential.source !== 'user_key') {
    return new Response(JSON.stringify({
      error: 'Auto-fix requires your own API key. Add one in Settings > AI Providers.',
      requiresBYOK: true,
    }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!canUseAutofix(credential.provider)) {
    return new Response(JSON.stringify({
      error: `${credential.provider} is not certified for auto-fix. Use Anthropic or OpenAI.`,
    }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get stack context
  let stackContext = 'No stack description provided.';
  if (incident.stackId) {
    const stack = db.select().from(tenantSchema.stacks)
      .where(eq(tenantSchema.stacks.id, incident.stackId)).get();
    if (stack) stackContext = stack.description;
  }

  // Get latest diagnosis for context
  const diagnosis = db.select().from(tenantSchema.diagnoses)
    .where(eq(tenantSchema.diagnoses.incidentId, incidentId))
    .get();

  const diagnosisContext = diagnosis
    ? `\n\nPrevious AI diagnosis:\nRoot causes: ${diagnosis.rootCauses}\nSuggested commands: ${diagnosis.suggestedCommands || 'none'}`
    : '';

  // --- Action: plan ---
  if (action === 'plan') {
    const systemPrompt = `You are an incident remediation assistant. The user runs this stack:\n${stackContext}${diagnosisContext}\n\nGenerate a detailed remediation plan for this incident. Include:\n1. Step-by-step fix instructions\n2. Commands to run (with expected output)\n3. Files that may need modification (with specific changes)\n4. Verification steps to confirm the fix worked\n5. Rollback steps if the fix makes things worse\n6. Risk assessment (low/medium/high) for each step\n\nRespond with JSON:\n{\n  "summary": "one-line summary of the fix",\n  "steps": [\n    {\n      "order": 1,\n      "description": "what to do",\n      "commands": ["shell commands to run"],\n      "files": [{"path": "/path/to/file", "change": "description of change"}],\n      "verification": "how to verify this step worked",\n      "risk": "low|medium|high",\n      "rollback": "how to undo this step"\n    }\n  ],\n  "totalRisk": "low|medium|high",\n  "estimatedTime": "human-readable time estimate"\n}\n\nRespond ONLY with valid JSON, no markdown fences.`;

    try {
      const result = await callProvider(credential, systemPrompt, `Incident: ${incident.title}\n\n${incident.description}`);

      logProviderAudit(userId, incidentId, 'autofix_plan', credential.provider, credential.model, 'user_key', 'success');

      let plan: any;
      try {
        let jsonText = result.text.trim();
        if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
        plan = JSON.parse(jsonText);
      } catch {
        plan = { summary: 'Plan generated (parsing failed)', steps: [], raw: result.text };
      }

      return new Response(JSON.stringify({
        plan,
        model: credential.model,
        provider: credential.provider,
        tokens: { prompt: result.promptTokens, completion: result.completionTokens },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      logProviderAudit(userId, incidentId, 'autofix_plan', credential.provider, credential.model, 'user_key', 'failed', err.message?.slice(0, 200));
      return new Response(JSON.stringify({ error: `Plan generation failed: ${err.message}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // --- Action: patch ---
  if (action === 'patch') {
    const { stepIndex, filePath } = body;

    const systemPrompt = `You are a code remediation assistant. The user runs this stack:\n${stackContext}${diagnosisContext}\n\nGenerate a specific file patch for the requested change. Return a unified diff format that can be applied.\n\nRespond with JSON:\n{\n  "filePath": "/path/to/file",\n  "description": "what this patch does",\n  "diff": "unified diff content (--- a/file\\n+++ b/file\\n@@ ...)",\n  "risk": "low|medium|high",\n  "rollbackDiff": "reverse diff to undo this change"\n}\n\nRespond ONLY with valid JSON, no markdown fences.`;

    const patchPrompt = `Generate a patch for: ${incident.title}\n\nFile: ${filePath || 'determine from context'}\nStep: ${stepIndex !== undefined ? `Step ${stepIndex + 1}` : 'full fix'}\nIncident description: ${incident.description}`;

    try {
      const result = await callProvider(credential, systemPrompt, patchPrompt);

      logProviderAudit(userId, incidentId, 'autofix_plan', credential.provider, credential.model, 'user_key', 'success');

      let patch: any;
      try {
        let jsonText = result.text.trim();
        if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
        patch = JSON.parse(jsonText);
      } catch {
        patch = { description: 'Patch generated (parsing failed)', diff: result.text, risk: 'unknown' };
      }

      return new Response(JSON.stringify({
        patch,
        model: credential.model,
        provider: credential.provider,
        tokens: { prompt: result.promptTokens, completion: result.completionTokens },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: `Patch generation failed: ${err.message}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};

// --- Provider call helper (reuses the same pattern as diagnose.ts) ---
async function callProvider(
  credential: { provider: string; model: string; apiKey: string },
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  if (credential.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${credential.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credential.model,
        max_tokens: 4096,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json() as any;
    return {
      text: data.choices?.[0]?.message?.content || '',
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
    };
  }

  if (credential.provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${credential.model}:generateContent?key=${credential.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
    const data = await res.json() as any;
    return {
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
    };
  }

  // Anthropic (default) — with prompt caching for system instructions
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: credential.apiKey });
  const response = await client.messages.create({
    model: credential.model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });
  return {
    text: response.content[0].type === 'text' ? response.content[0].text : '',
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
  };
}
