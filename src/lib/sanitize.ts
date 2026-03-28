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

export interface SanitizationResult {
  sanitizedContent: string;
  sanitizedTitle: string;
  replacements: { original: string; replacement: string; category: string }[];
  flagged: boolean;
  flagReason?: string;
}

/**
 * Sanitize a document for community contribution.
 * Strips all PII, hostnames, IPs, credentials, and org-specific details.
 * Also checks for inappropriate content and factual red flags.
 */
export async function sanitizeForCommunity(opts: {
  title: string;
  content: string;
  model?: string;
}): Promise<SanitizationResult> {
  const model = opts.model || 'claude-haiku-4-5-20251001';

  const response = await getClient().messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are a document sanitizer for a community knowledge base of operational/DevOps documentation. Your job is to strip all identifying information while preserving technical accuracy.

**Input document title:** ${opts.title}

**Input document content:**
${opts.content}

**Instructions:**

1. **Strip and generalize these categories:**
   - Hostnames → \`<hostname>\`, \`<server-1>\`
   - IP addresses → \`<internal-ip>\`, \`<lan-ip>\`, \`<external-ip>\`
   - Container names → \`<container-name>\` (keep generic names like "nginx", "postgres" if the pattern requires them)
   - Custom ports → \`<custom-port>\` (keep standard ports: 80, 443, 5432, 3306, 6379, 8080)
   - Credentials → \`<api-key>\`, \`<password>\`, \`<token>\`
   - Internal URLs → \`<internal-url>\`, \`<dashboard-url>\`
   - Organization/company names → \`<org-name>\`
   - File paths with user-specific segments → generalized (\`/home/<user>/\`, \`/opt/<service>/\`)
   - Domain names → \`<domain>\`, \`example.com\`
   - Person names → \`<user>\`, \`<engineer>\`

2. **Content quality check:**
   - Flag if the document contains no actionable technical content (just a complaint or vague description)
   - Flag if it contains potentially harmful instructions (destructive commands without warnings, security exploits without responsible disclosure context)
   - Flag if it appears to be AI-generated boilerplate without real operational experience behind it

3. **Output format (JSON only, no markdown wrapping):**
\`\`\`
{
  "sanitizedTitle": "...",
  "sanitizedContent": "...",
  "replacements": [
    {"original": "actual-hostname.example.com", "replacement": "<hostname>", "category": "hostname"},
    ...
  ],
  "flagged": false,
  "flagReason": null
}
\`\`\`

If the document is already generic/sanitized (no PII found), return it unchanged with an empty replacements array.
If flagged, set flagged=true and explain in flagReason. Still sanitize the content even if flagged.

Return ONLY valid JSON. No markdown code fences.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    // Strip any markdown code fences if the model wraps it
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      sanitizedTitle: parsed.sanitizedTitle || opts.title,
      sanitizedContent: parsed.sanitizedContent || opts.content,
      replacements: parsed.replacements || [],
      flagged: parsed.flagged || false,
      flagReason: parsed.flagReason || undefined,
    };
  } catch {
    // If parsing fails, return the original with a flag
    return {
      sanitizedTitle: opts.title,
      sanitizedContent: opts.content,
      replacements: [],
      flagged: true,
      flagReason: 'Sanitization AI response could not be parsed. Manual review required.',
    };
  }
}
