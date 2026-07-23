import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../../../../lib/rbac';

/**
 * POST /app/api/incidents/autofix
 * Actions: plan, patch, apply
 *
 * Auto-fix requires a BYOK user key — never uses platform key.
 * Generates remediation plans, file patches, and applies approved fixes.
 */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { incidentId, action } = body;
  if (!incidentId || !action) {
    return new Response(JSON.stringify({ error: 'incidentId and action are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();

  // Fetch incident
  const incident = db.select().from(schema.incidents)
    .where(eq(schema.incidents.id, incidentId)).get();
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

  // Resolve the model: BYOK user key if present, otherwise LOCAL OLLAMA (the default Seaynic
  // provides). Auto-fix never requires a user key (Charlie 2026-06-12 — Ollama is the floor).
  const credential = resolveForDiagnostics(userId, 'paid');
  if (!credential) {
    return new Response(JSON.stringify({
      error: 'No AI model available. Ensure local Ollama is running, or add your own API key in Settings > AI Providers.',
    }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  // BYOK providers must be certified for autofix; the local Ollama default is always allowed.
  if (credential.source === 'user_key' && !canUseAutofix(credential.provider)) {
    return new Response(JSON.stringify({
      error: `${credential.provider} is not certified for auto-fix. Use Anthropic, OpenAI, or the built-in local model.`,
    }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get stack context
  let stackContext = 'No stack description provided.';
  if (incident.stackId) {
    const stack = db.select().from(schema.stacks)
      .where(eq(schema.stacks.id, incident.stackId)).get();
    if (stack) stackContext = stack.description;
  }

  // Get latest diagnosis for context
  const diagnosis = db.select().from(schema.diagnoses)
    .where(eq(schema.diagnoses.incidentId, incidentId))
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
    } catch (error: unknown) {
      logProviderAudit(userId, incidentId, 'autofix_plan', credential.provider, credential.model, 'user_key', 'failed', error instanceof Error ? error.message : String(error)?.slice(0, 200));
      return new Response(JSON.stringify({ error: `Plan generation failed: ${error instanceof Error ? error.message : String(error)}` }), {
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
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: `Patch generation failed: ${error instanceof Error ? error.message : String(error)}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // --- Action: apply (gated auto-remediation, P4) ---
  if (action === 'apply') {
    const { command, confirmed, autonomous } = body;
    if (!command || typeof command !== 'string') {
      return new Response(JSON.stringify({ error: 'command is required for apply' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Applying a fix on a running service is operator-level — require manage_settings.
    const { checkRBAC } = await import('../../../../lib/rbac');
    const manageBlock = checkRBAC(locals, 'manage_settings');
    if (manageBlock) return manageBlock;

    const { applyRemediation, classifyAutoApply } = await import('../../../../lib/autofix-apply');

    // ── Operating-mode gate (autonomous path only) ──────────────────────────────
    // A HUMAN with manage_settings clicking "apply" is a manual operator action and runs as
    // before. An AUTONOMOUS proposer (autonomous:true) must pass the mode gate: it may only act
    // in 'autofix' mode, only within the non-destructive ceiling (unless god mode), and anything
    // above the ceiling is PARKED against this incident for human approval instead of applied.
    if (autonomous) {
      const {
        decideAutonomous, parkPendingFix,
      } = await import('../../../../lib/observatory/operating-mode');
      const cls = classifyAutoApply(command);
      const verdict = decideAutonomous(userId, cls);

      if (verdict.decision === 'denied') {
        return new Response(JSON.stringify({
          applied: false, decision: 'denied', autonomous: true,
          reason: verdict.reason, mode: verdict.mode, classification: cls,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (verdict.decision === 'park') {
        const parked = parkPendingFix(userId, incidentId, command, cls,
          verdict.reason, body.proposedBy || 'autopilot');
        // Notify a human that an above-ceiling fix awaits approval (best-effort).
        try {
          const { notify } = await import('../../../../lib/notify');
          await notify(userId, {
            event: 'autofix_pending_approval',
            title: `Approval needed: auto-fix for "${incident.title}"`,
            body: `An autonomous remediation exceeds the non-destructive ceiling and needs your approval:\n\n${command}\n\n${verdict.reason}`,
            url: `/app/incidents/${incidentId}`,
            metadata: { incidentId, command, pendingFixId: parked.id, reason: verdict.reason },
          });
        } catch { /* notifications best-effort */ }
        return new Response(JSON.stringify({
          applied: false, decision: 'park', autonomous: true, pendingFixId: parked.id,
          deduped: parked.deduped, reason: verdict.reason, mode: verdict.mode, classification: cls,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // verdict.decision === 'apply' → fall through to execute, recording the outcome below.
    }

    // Resolve the Windlass /exec endpoint from the user's windlass config.
    const wConfig = db.select().from(schema.windlassConfig)
      .where(eq(schema.windlassConfig.userId, userId)).get();

    const execViaWindlass = async (cmd: string) => {
      if (!wConfig?.endpointUrl) throw new Error('Windlass not configured — cannot apply remediation');
      const url = wConfig.endpointUrl.replace(/\/$/, '') + '/exec';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`Windlass /exec HTTP ${res.status}`);
      const data: unknown = await res.json();
      return { exitCode: data.exitCode ?? 1, stdout: data.stdout ?? '', stderr: data.stderr ?? '' };
    };

    // An autonomous apply that reached here was cleared by the mode gate (non-destructive within
    // ceiling, or god mode granted) — force it through P4's confirm gate. A human apply uses the
    // explicit `confirmed` flag as before.
    const force = autonomous ? true : Boolean(confirmed);
    const result = await applyRemediation(command, execViaWindlass, force);

    // Audit: record the apply decision + outcome on the incident timeline.
    try {
      logProviderAudit(userId, incidentId, 'autofix_apply', credential.provider,
        credential.model, 'user_key', result.applied ? 'success' : 'failed',
        `${result.decision}: ${result.reason}`.slice(0, 200));
    } catch { /* audit best-effort */ }

    // Auto-pilot accounting: an autonomous apply's exit code drives promotion/killswitch.
    // exitCode 0 = success; non-zero or thrown = failure. The caller may pass loopSignal/
    // catastrophe (e.g. the proposer already noticed it's repeating itself).
    if (autonomous) {
      const ok = result.applied && (result.exitCode === 0 || result.exitCode === undefined);
      try {
        const { recordAutonomousOutcome } = await import('../../../../lib/observatory/operating-mode');
        recordAutonomousOutcome(userId, ok, {
          loopSignal: Boolean(body.loopSignal),
          catastrophe: body.catastrophe,
        });
      } catch { /* accounting best-effort */ }
      // Closed-loop (P6): if this remediation came from a learned/auto pattern, feed the outcome
      // back into that pattern's confidence so good patterns rise and bad ones decay.
      if (body.patternId && typeof body.patternId === 'string') {
        try {
          const { recordPatternOutcome } = await import('../../../../lib/observatory/pattern-feedback');
          recordPatternOutcome({
            patternId: body.patternId, success: ok, incidentId, agentType: body.proposedBy || 'autopilot',
          });
        } catch { /* feedback best-effort */ }
      }
    }

    return new Response(JSON.stringify({
      ...result,
      autonomous: Boolean(autonomous),
      classification: classifyAutoApply(command),
    }), {
      status: result.applied || result.decision === 'escalate' ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
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

  // Ollama (local default — what Seaynic provides; no API key needed).
  if (credential.provider === 'ollama') {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credential.model,
        system: systemPrompt,
        prompt: userMessage,
        stream: false,
        options: { num_predict: 4096 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json() as any;
    return {
      text: data.response || '',
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
    };
  }

  // Anthropic (BYOK only) — with prompt caching for system instructions
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
