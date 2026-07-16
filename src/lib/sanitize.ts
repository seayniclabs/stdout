/**
 * Document sanitization (Charlie 2026-06-12).
 *
 * Two layers, in order:
 *   1. DETERMINISTIC scrub (secret-scrub.ts) — pure regex, no LLM, the non-negotiable floor.
 *      Always strips credential-class data; at community level also strips org-identifying data.
 *      This runs FIRST and ALWAYS, so secrets never reach disk even if no model is available.
 *   2. LLM generalization + screening — Ollama-first (the local model Seaynic provides), BYOK
 *      optional. Generalizes remaining hostnames/paths/org names and screens accuracy +
 *      appropriateness for community submissions. If no model is available, we DEGRADE GRACEFULLY
 *      to scrub-only (the doc is still secret-safe; community publish is flagged for review).
 *
 * Ollama-floor rule: this module must never REQUIRE a BYOK key. See
 * [[Ollama is the AI floor BYOK is optional]].
 */

import { scrubSecrets, type ScrubLevel } from './secret-scrub';

export interface SanitizationResult {
  sanitizedContent: string;
  sanitizedTitle: string;
  replacements: { original?: string; replacement?: string; category: string; count?: number }[];
  /** community accuracy/appropriateness flag — true means "needs human review before publish". */
  flagged: boolean;
  flagReason?: string;
  /** the deterministic pass found credential-class data (audit signal). */
  foundSecrets: boolean;
  /** whether the LLM screening layer actually ran (false = scrub-only degraded mode). */
  llmScreened: boolean;
}

const SANITIZER_SYSTEM = `You are a document sanitizer for a community knowledge base of operational/DevOps documentation. The input has ALREADY had credentials, IPs, emails, and internal hostnames mechanically redacted — do NOT assume it's clean of identifying CONTEXT. Your job:

1. Generalize any remaining identifying details: org/company names → <org-name>; person names → <user>; remaining custom hostnames/paths/domains → generic placeholders. Keep generic tech names (nginx, postgres) and standard ports (80,443,5432,3306,6379,8080).
2. Accuracy check: flag if the doc has no actionable technical content, contains harmful instructions (destructive commands without warnings, exploits without disclosure context), or reads like AI boilerplate with no real operational experience.
3. Appropriateness check: flag if it contains profanity, harassment, off-topic, or anything inappropriate for a public technical library.

Output JSON ONLY (no markdown fences):
{"sanitizedTitle":"...","sanitizedContent":"...","flagged":false,"flagReason":null}
If already generic, return content unchanged with flagged=false.`;

/**
 * Sanitize a document.
 *
 * @param level   'internal' (lenient: scrub secrets only, no LLM screening required) |
 *                'community' (aggressive scrub + LLM generalization + accuracy/appropriateness gate).
 * @param userId  resolves the local Ollama / BYOK model for the LLM layer (community only).
 */
export async function sanitizeDocument(opts: {
  title: string;
  content: string;
  level: ScrubLevel;
  userId?: string;
}): Promise<SanitizationResult> {
  // Layer 1 — deterministic scrub (always).
  const scrubbed = scrubSecrets({ title: opts.title, content: opts.content, level: opts.level });
  const baseReplacements = scrubbed.replacements.map((r) => ({ category: r.category, count: r.count }));

  // Internal docs: scrub is sufficient (no required LLM screening). Done.
  if (opts.level === 'internal') {
    return {
      sanitizedTitle: scrubbed.title,
      sanitizedContent: scrubbed.content,
      replacements: baseReplacements,
      flagged: false,
      foundSecrets: scrubbed.foundSecrets,
      llmScreened: false,
    };
  }

  // Community docs: layer 2 — LLM generalization + accuracy/appropriateness screening.
  // Ollama-first, BYOK-optional; degrade to scrub-only (flagged for review) if no model.
  let credential: { provider: string; model: string; apiKey: string } | null = null;
  if (opts.userId) {
    try {
      const { resolveForDiagnostics } = await import('./ai-providers');
      credential = resolveForDiagnostics(opts.userId, 'paid');
    } catch { credential = null; }
  }

  if (!credential) {
    return {
      sanitizedTitle: scrubbed.title,
      sanitizedContent: scrubbed.content,
      replacements: baseReplacements,
      flagged: true,
      flagReason: 'No AI model available to screen for accuracy/appropriateness — needs human review before publish.',
      foundSecrets: scrubbed.foundSecrets,
      llmScreened: false,
    };
  }

  try {
    const result = await callSanitizer(credential, scrubbed.title, scrubbed.content);
    return {
      sanitizedTitle: result.sanitizedTitle || scrubbed.title,
      sanitizedContent: result.sanitizedContent || scrubbed.content,
      replacements: baseReplacements,
      flagged: Boolean(result.flagged),
      flagReason: result.flagReason || undefined,
      foundSecrets: scrubbed.foundSecrets,
      llmScreened: true,
    };
  } catch (error: unknown) {
    // LLM failed — the doc is still secret-safe (layer 1 ran); flag for human review.
    return {
      sanitizedTitle: scrubbed.title,
      sanitizedContent: scrubbed.content,
      replacements: baseReplacements,
      flagged: true,
      flagReason: `Sanitization screening failed (${error instanceof Error ? error.message : String(error) || 'unknown'}) — needs human review.`,
      foundSecrets: scrubbed.foundSecrets,
      llmScreened: false,
    };
  }
}

/** Back-compat shim for existing callers of sanitizeForCommunity. */
export async function sanitizeForCommunity(opts: {
  title: string;
  content: string;
  model?: string;
  userId?: string;
}): Promise<SanitizationResult & { sanitizedContent: string; sanitizedTitle: string }> {
  return sanitizeDocument({ title: opts.title, content: opts.content, level: 'community', userId: opts.userId });
}

interface SanitizerJson {
  sanitizedTitle?: string;
  sanitizedContent?: string;
  flagged?: boolean;
  flagReason?: string | null;
}

async function callSanitizer(
  credential: { provider: string; model: string; apiKey: string },
  title: string,
  content: string,
): Promise<SanitizerJson> {
  const userMessage = `**Input document title:** ${title}\n\n**Input document content:**\n${content}`;

  let text = '';
  if (credential.provider === 'ollama') {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credential.model,
        system: SANITIZER_SYSTEM,
        prompt: userMessage,
        stream: false,
        format: 'json',
        options: { num_predict: 4096 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json() as any;
    text = data.response || '';
  } else if (credential.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${credential.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: credential.model,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SANITIZER_SYSTEM }, { role: 'user', content: userMessage }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    const data = await res.json() as any;
    text = data.choices?.[0]?.message?.content || '';
  } else {
    // Anthropic (BYOK)
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: credential.apiKey });
    const response = await client.messages.create({
      model: credential.model,
      max_tokens: 4096,
      system: [{ type: 'text', text: SANITIZER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    });
    text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned) as SanitizerJson;
}
