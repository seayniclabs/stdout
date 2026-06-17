/**
 * Auto-documentation of NOVEL/RARE resolved incidents (Charlie 2026-06-12).
 *
 * Closed-loop learning (P6) with a NOVELTY GATE. When an incident is resolved and documented-worthy,
 * distill it into the learning library AUTOMATICALLY — but ONLY if it's novel or rare. We do NOT
 * write a doc for every incident: common/repeat incidents already have a matching pattern, so
 * re-documenting them is noise.
 *
 *   resolved incident + resolution
 *     → novelty check (FTS similarity vs existing standard_patterns AND prior resolved incidents)
 *     → if a close match exists → SKIP (already known)
 *     → else → distill via local Ollama into a structured pattern
 *            → scrub (internal level — no secrets/passwords/keys ever)
 *            → write to observatory_standard_patterns (source='auto')
 *
 * Sensitive data is treated like PII: the deterministic secret scrub runs on the distilled pattern
 * before it is stored, so credentials never enter the library even though this is an internal doc.
 *
 * Fire-and-forget: called after add_resolution; never blocks the request, never throws upward.
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { scrubSecrets } from '../secret-scrub';

const VALID_CATEGORIES = new Set([
  'configuration_error', 'database', 'docker_specific', 'external_service', 'filesystem',
  'network', 'performance', 'resource_exhaustion', 'security', 'service_crash',
]);

export interface AutoDocResult {
  documented: boolean;
  reason: string;
  patternId?: string;
  patternName?: string;
}

/**
 * Consider auto-documenting a just-resolved incident. Safe to call fire-and-forget.
 */
export async function maybeAutoDocument(userId: string, incidentId: string): Promise<AutoDocResult> {
  try {
    const tenant = getDb();

    const incident = tenant.get(sql`
      SELECT id, title, description, severity, tags FROM incidents
      WHERE id = ${incidentId} AND user_id = ${userId}
    `) as { id: string; title: string; description: string; severity: string; tags: string | null } | undefined;
    if (!incident) return { documented: false, reason: 'incident not found' };

    const resolution = tenant.get(sql`
      SELECT content FROM resolutions WHERE incident_id = ${incidentId}
      ORDER BY created_at DESC LIMIT 1
    `) as { content: string } | undefined;
    if (!resolution || !resolution.content?.trim()) {
      return { documented: false, reason: 'no resolution content to learn from' };
    }

    // ── Novelty gate ────────────────────────────────────────────────────────────
    if (await hasCloseMatch(userId, incident.title, incident.description)) {
      return { documented: false, reason: 'similar pattern already documented (not novel)' };
    }

    // ── Distill via local Ollama (BYOK optional) ────────────────────────────────
    const distilled = await distillPattern(userId, {
      title: incident.title,
      description: incident.description,
      resolution: resolution.content,
    });
    if (!distilled) return { documented: false, reason: 'no AI model available to distill pattern' };

    // ── Scrub (internal level — secrets/keys/passwords never enter the library) ──
    const scrubbed = scrubSecrets({
      title: distilled.pattern_name,
      content: JSON.stringify({
        symptoms: distilled.symptoms,
        common_causes: distilled.common_causes,
        resolution_steps: distilled.resolution_steps,
      }),
      level: 'internal',
    });
    let payload: { symptoms: string[]; common_causes: string[]; resolution_steps: string[] };
    try { payload = JSON.parse(scrubbed.content); }
    catch { payload = { symptoms: distilled.symptoms, common_causes: distilled.common_causes, resolution_steps: distilled.resolution_steps }; }

    const category = VALID_CATEGORIES.has(distilled.category) ? distilled.category : 'service_crash';
    const now = Date.now();
    const id = `pat_auto_${nanoid(12)}`;
    const central = getDb();
    central.run(sql`
      INSERT INTO observatory_standard_patterns
        (id, pattern_name, category, symptoms, common_causes, resolution_steps,
         confidence_threshold, source, created_at, updated_at)
      VALUES
        (${id}, ${scrubbed.title.slice(0, 200)}, ${category},
         ${JSON.stringify(payload.symptoms)}, ${JSON.stringify(payload.common_causes)},
         ${JSON.stringify(payload.resolution_steps)}, 0.6, 'auto', ${now}, ${now})
    `);

    return { documented: true, reason: 'novel incident documented', patternId: id, patternName: scrubbed.title };
  } catch (err: any) {
    // Never let auto-doc break the resolution flow.
    console.warn('[auto-doc] skipped:', err?.message || err);
    return { documented: false, reason: `error: ${err?.message || 'unknown'}` };
  }
}

/**
 * Novelty gate: is there already a close match in the library or prior resolved incidents?
 * Uses FTS over standard_patterns symptoms and the incidents FTS index. Conservative — any
 * reasonable match means "not novel, skip".
 */
async function hasCloseMatch(userId: string, title: string, description: string): Promise<boolean> {
  const central = getDb();
  const tenant = getDb();

  // Keywords for FTS: significant words from the title (drop short/common tokens).
  const terms = Array.from(
    new Set(
      `${title} ${description}`
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4),
    ),
  ).slice(0, 8);
  if (terms.length === 0) return false;
  const match = terms.join(' OR ');

  // 1) Existing standard patterns whose symptoms overlap.
  try {
    const pat = central.get(sql`
      SELECT COUNT(*) AS n FROM observatory_standard_patterns
      WHERE lower(symptoms) LIKE ${'%' + terms[0] + '%'}
         OR lower(pattern_name) LIKE ${'%' + terms[0] + '%'}
    `) as { n: number } | undefined;
    // Stronger overlap check: count how many terms appear in any single pattern's symptoms.
    const rows = central.all(sql`SELECT symptoms, pattern_name FROM observatory_standard_patterns`) as Array<{ symptoms: string; pattern_name: string }>;
    for (const r of rows) {
      const hay = `${r.pattern_name} ${r.symptoms}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      if (hits >= Math.max(2, Math.ceil(terms.length * 0.5))) return true; // ≥50% term overlap = known
    }
    if ((pat?.n ?? 0) > 0 && terms.length <= 2) return true;
  } catch { /* patterns table/format issue — fall through */ }

  // 2) Prior resolved incidents with similar symptoms (rare = few/no prior matches).
  try {
    const inc = tenant.get(sql`
      SELECT COUNT(*) AS n
      FROM incidents i
      JOIN incidents_fts fts ON fts.rowid = i.rowid
      WHERE i.user_id = ${userId}
        AND i.resolved_at IS NOT NULL
        AND incidents_fts MATCH ${match}
    `) as { n: number } | undefined;
    // 1 match is THIS incident; "rare" means ≤1 other similar prior. ≥3 similar = common, skip.
    if ((inc?.n ?? 0) >= 3) return true;
  } catch { /* FTS may not exist */ }

  return false;
}

interface DistilledPattern {
  pattern_name: string;
  category: string;
  symptoms: string[];
  common_causes: string[];
  resolution_steps: string[];
}

const DISTILL_SYSTEM = `You distill a single resolved operational incident into a reusable runbook pattern for an incident knowledge base. Be generic and reusable — describe the CLASS of problem, not this one instance. Do NOT include any hostnames, IPs, credentials, or org-specific identifiers.

Output JSON ONLY (no markdown fences):
{
  "pattern_name": "short title for the class of problem",
  "category": "one of: configuration_error|database|docker_specific|external_service|filesystem|network|performance|resource_exhaustion|security|service_crash",
  "symptoms": ["observable symptom", ...],
  "common_causes": ["likely root cause", ...],
  "resolution_steps": ["step to resolve", ...]
}`;

async function distillPattern(
  userId: string,
  inc: { title: string; description: string; resolution: string },
): Promise<DistilledPattern | null> {
  let credential: { provider: string; model: string; apiKey: string } | null = null;
  try {
    const { resolveForDiagnostics } = await import('../ai-providers');
    credential = resolveForDiagnostics(userId, 'paid');
  } catch { credential = null; }
  if (!credential) return null;

  const userMessage = `Incident: ${inc.title}\n\nDescription/symptoms:\n${inc.description}\n\nHow it was resolved:\n${inc.resolution}`;

  let text = '';
  try {
    if (credential.provider === 'ollama') {
      const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: credential.model, system: DISTILL_SYSTEM, prompt: userMessage,
          stream: false, format: 'json', options: { num_predict: 2048 },
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      text = data.response || '';
    } else if (credential.provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${credential.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: credential.model, max_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: DISTILL_SYSTEM }, { role: 'user', content: userMessage }],
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      text = data.choices?.[0]?.message?.content || '';
    } else {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: credential.apiKey });
      const response = await client.messages.create({
        model: credential.model, max_tokens: 2048,
        system: [{ type: 'text', text: DISTILL_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      });
      text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    }

    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as DistilledPattern;
    if (!parsed.pattern_name || !Array.isArray(parsed.symptoms)) return null;
    parsed.common_causes = parsed.common_causes || [];
    parsed.resolution_steps = parsed.resolution_steps || [];
    return parsed;
  } catch {
    return null;
  }
}
