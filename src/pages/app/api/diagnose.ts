import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../lib/db';
import { diagnoseWithTools } from '../../../lib/diagnose-with-tools';
import { diagnoseIncident } from '../../../lib/diagnose';
import { logAudit, getClientIp } from '../../../lib/audit';
import { notify } from '../../../lib/notify';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { requireAuth } from '../../../lib/rbac';

// --- Per-user rate limiting for AI diagnosis ---
const DIAGNOSE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DIAGNOSE_LIMIT_FREE = 5;
const DIAGNOSE_LIMIT_PAID = 20;
const diagnoseRateMap = new Map<string, number[]>(); // userId → timestamps

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - DIAGNOSE_WINDOW_MS;
  for (const [key, timestamps] of diagnoseRateMap) {
    const valid = timestamps.filter(t => t > cutoff);
    if (valid.length === 0) {
      diagnoseRateMap.delete(key);
    } else {
      diagnoseRateMap.set(key, valid);
    }
  }
}, 10 * 60 * 1000);

function checkDiagnoseRateLimit(userId: string, isPaid: boolean): Response | null {
  const now = Date.now();
  const cutoff = now - DIAGNOSE_WINDOW_MS;
  const limit = isPaid ? DIAGNOSE_LIMIT_PAID : DIAGNOSE_LIMIT_FREE;

  let timestamps = diagnoseRateMap.get(userId) || [];
  timestamps = timestamps.filter(t => t > cutoff);

  if (timestamps.length >= limit) {
    const oldestValid = timestamps[0];
    const retryAfter = Math.ceil((oldestValid + DIAGNOSE_WINDOW_MS - now) / 1000);
    return new Response(JSON.stringify({
      error: `Rate limit exceeded. ${isPaid ? 'Paid' : 'Free'} tier allows ${limit} diagnoses per hour. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
      retryable: true,
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    });
  }

  timestamps.push(now);
  diagnoseRateMap.set(userId, timestamps);
  return null;
}

export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  const { checkRBAC } = await import('../../../lib/rbac');
  const rbacBlock = checkRBAC(locals, 'create');
  if (rbacBlock) return rbacBlock;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        module: 'diagnose',
        timestamp: new Date().toISOString(),
        msg: 'Failed to parse request JSON',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return new Response('Invalid JSON', { status: 400 });
  }

  // CSRF check
  const { validateCsrf } = await import('../../../middleware');
  const csrfToken = request.headers.get('x-csrf-token') || (body as any)._csrf;
  if (!validateCsrf(csrfToken, cookies)) {
    return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { incidentId } = body;
  if (!incidentId) {
    return new Response(JSON.stringify({ error: 'Missing incidentId' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user!.id;
  const db = getDb();
  const incident = db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId)).get();
  if (!incident || incident.userId !== locals.user.id) {
    return new Response(JSON.stringify({ error: 'Incident not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Operating-mode gate: diagnosis (the brain explaining incidents) requires effective mode
  // ≥ diagnose. In 'discover' (eyes only) the brain does not run. A human manually triggering
  // diagnose still goes through here — discover means the instance is configured eyes-only.
  try {
    const { canDiagnose } = await import('../../../lib/observatory/operating-mode');
    if (!canDiagnose(userId)) {
      return new Response(JSON.stringify({
        error: "Diagnosis is disabled in 'discover' mode. Switch to 'diagnose' or 'autofix' in Observatory settings to let the brain analyze incidents.",
        mode: 'discover',
        retryable: false,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (err) {
    // If the gate can't be read, log the error and fail open to preserve existing behavior
    console.warn(
      JSON.stringify({
        level: 'WARN',
        module: 'diagnose',
        timestamp: new Date().toISOString(),
        msg: 'Failed to check diagnosis operating mode, failing open',
        error: err instanceof Error ? err.message : String(err),
        userId,
      })
    );
  }

  // Get stack context
  let stackContext = 'No stack description provided.';
  if (incident.stackId) {
    const stack = db.select().from(schema.stacks).where(eq(schema.stacks.id, incident.stackId)).get();
    if (stack) stackContext = stack.description;
  }

  // Get past resolutions for similar incidents (FTS5 search)
  const pastResolutions: string[] = [];
  try {
    const rawDb = (db as any).$client;
    if (rawDb?.prepare) {
      const ftsResults = rawDb.prepare(
        `SELECT r.content FROM resolutions r
         JOIN incidents i ON r.incident_id = i.id
         WHERE i.id != ?
         ORDER BY r.created_at DESC LIMIT 3`
      ).all(incidentId);
      for (const row of ftsResults) {
        if (row.content) pastResolutions.push(row.content);
      }
    }
  } catch (err) {
    // FTS may not be populated yet; continue without historical context
    console.warn(
      JSON.stringify({
        level: 'WARN',
        module: 'diagnose',
        timestamp: new Date().toISOString(),
        msg: 'Failed to fetch past resolutions via FTS, continuing without historical context',
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user.id,
        incidentId,
      })
    );
  }

  const { getUserLimits } = await import('../../../lib/tiers');
  const { limits } = getUserLimits(locals.user);
  const tier = limits.aiModel === 'sonnet' ? 'paid' : 'free';
  const isPaid = tier === 'paid';

  // Check per-user rate limit before calling AI
  const rateLimitResponse = checkDiagnoseRateLimit(locals.user.id, isPaid);
  if (rateLimitResponse) return rateLimitResponse;

  // Fetch enabled data sources for diagnosis context enrichment
  let dataSources: Array<{ type: string; name: string; enabled: boolean }> = [];
  try {
    const allSources = db.select().from(schema.dataSources)
      .where(eq(schema.dataSources.userId, locals.user.id))
      .all();
    dataSources = allSources.map((s) => ({
      type: s.type,
      name: s.name,
      enabled: !!s.enabled,
    }));
  } catch (err) {
    // Data sources table may not exist yet; continue without data sources
    console.warn(
      JSON.stringify({
        level: 'WARN',
        module: 'diagnose',
        timestamp: new Date().toISOString(),
        msg: 'Failed to fetch data sources, continuing without data source context',
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user.id,
      })
    );
  }

  const description = `Title: ${incident.title}\n\n${incident.description}`;

  // BYOK credential routing — try user key first, fall back to platform key
  const { resolveForDiagnostics, logAudit: logProviderAudit } = await import('../../../lib/ai-providers');
  let credential: Awaited<ReturnType<typeof resolveForDiagnostics>> = null;
  try {
    credential = resolveForDiagnostics(locals.user.id, tier as 'free' | 'paid');
  } catch (err) {
    // Resolver may fail if DB not ready; will be caught by null check below
    console.warn(
      JSON.stringify({
        level: 'WARN',
        module: 'diagnose',
        timestamp: new Date().toISOString(),
        msg: 'Failed to resolve AI provider credentials',
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user.id,
      })
    );
  }

  // resolveForDiagnostics falls back to local Ollama, so this is only hit if even that resolver
  // throws. Local Ollama is the default; BYOK is an optional add-on (never required).
  if (!credential) {
    return new Response(JSON.stringify({
      error: 'No AI model available. Ensure local Ollama is running, or add your own API key in Settings > AI Providers.',
      retryable: false,
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Tool-augmented diagnosis (P7b): let the brain run ONE read-only diagnostic tool and feed the
  // real output into the diagnosis. Best-effort — never blocks diagnosis if it fails.
  let toolContextBlock = '';
  let toolUsed: { tool?: string; args?: Record<string, unknown>; output?: string; exitCode?: number } | null = null;
  try {
    const { augmentWithTool } = await import('../../../lib/observatory/tool-augmented-diagnose');
    const aug = await augmentWithTool({
      userId,
      incidentTitle: incident.title,
      incidentDescription: incident.description,
      credential: {
        provider: credential?.provider || 'ollama',
        model: credential?.model || 'unknown',
        apiKey: credential?.source === 'user_key' ? credential.apiKey : '',
      },
    });
    if (aug.ran) toolUsed = { tool: aug.tool, args: aug.args, output: aug.output, exitCode: aug.exitCode };
    toolContextBlock = aug.contextBlock;
  } catch (err) {
    // Augmentation is best-effort; continue without tool context
    console.warn(
      JSON.stringify({
        level: 'WARN',
        module: 'diagnose',
        timestamp: new Date().toISOString(),
        msg: 'Tool-augmented diagnosis failed, continuing with basic diagnosis',
        error: err instanceof Error ? err.message : String(err),
        userId,
        incidentId,
      })
    );
  }

  const enrichedDescription = description + toolContextBlock;

  try {
    const result = await diagnoseIncident({
      stackContext,
      incidentDescription: enrichedDescription,
      pastResolutions,
      tier,
      dataSources,
      // Pass BYOK credential if resolved (otherwise diagnoseIncident uses platform key internally)
      apiKey: credential?.source === 'user_key' ? credential.apiKey : undefined,
      model: credential?.model,
      provider: credential?.provider,
    });

    // Log BYOK audit
    logProviderAudit(
      locals.user.id,
      incidentId,
      'diagnostics',
      credential?.provider || 'anthropic',
      result.model,
      credential?.source || 'ollama',
      'success',
    );

    // Store diagnosis
    const diagId = nanoid();
    db.insert(schema.diagnoses).values({
      id: diagId,
      incidentId,
      rootCauses: JSON.stringify(result.rootCauses),
      suggestedCommands: JSON.stringify(result.suggestedCommands),
      matchedIncidentIds: null,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      toolUsed: toolUsed ? JSON.stringify(toolUsed) : null,
      createdAt: new Date(),
    }).run();

    notify(locals.user.id, {
      event: 'diagnosis_complete',
      title: `Diagnosis: ${incident.title}`,
      body: result.rootCauses[0] || 'Analysis complete',
      url: `/app/incidents/${incidentId}`,
      metadata: { model: result.model, incidentId, credentialSource: credential?.source || 'ollama' },
    });

    logAudit('ai_diagnosis', {
      userId: locals.user.id,
      ip: getClientIp(request),
      details: { incidentId, model: result.model, tokens: result.promptTokens + result.completionTokens, credentialSource: credential?.source || 'ollama' },
    });

    return new Response(JSON.stringify({ ...result, toolUsed: toolUsed || undefined }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Diagnosis error:', error);

    // Log BYOK audit on failure
    logProviderAudit(
      locals.user.id,
      incidentId,
      'diagnostics',
      credential?.provider || 'anthropic',
      credential?.model || 'unknown',
      credential?.source || 'ollama',
      'failed',
      error instanceof Error ? error.message : String(error)?.slice(0, 200),
    );

    const status = error?.status === 429 ? 429 : 500;
    const message = status === 429
      ? 'AI service is busy. Please try again in a moment.'
      : 'Diagnosis failed. Please try again later.';
    return new Response(JSON.stringify({ error: message, retryable: status >= 429 }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
