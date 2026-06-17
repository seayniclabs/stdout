import type { APIRoute } from 'astro';
import {
  isSelfHosted,
  getAvailableProviders,
  listProviderKeys,
  saveProviderKey,
  deleteProviderKey,
  validateKey,
  PROVIDER_POLICIES,
  canUseDiagnostics,
  canUseAutofix,
} from '../../../../lib/ai-providers';

/**
 * GET /app/api/settings/ai-providers
 * List available providers and user's saved keys (no secrets).
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  if (!isSelfHosted()) {
    return new Response(JSON.stringify({ error: 'BYOK is available on self-hosted instances only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const providers = getAvailableProviders();
  const keys = listProviderKeys(userId);

  // Merge provider info with saved key status
  const result = providers.map(p => ({
    ...p,
    savedKey: keys.find(k => k.provider === p.id) || null,
    canDiagnostics: canUseDiagnostics(p.id),
    canAutofix: canUseAutofix(p.id),
  }));

  return new Response(JSON.stringify({ providers: result }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * POST /app/api/settings/ai-providers
 * Actions: save, delete, validate, update_preferences
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });

  if (!isSelfHosted()) {
    return new Response(JSON.stringify({ error: 'BYOK is available on self-hosted instances only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const action = body.action;

  // --- Save key ---
  if (action === 'save') {
    const { provider, apiKey, diagnosticsModel, autofixModel } = body;

    if (!provider || !apiKey) {
      return new Response(JSON.stringify({ error: 'provider and apiKey are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!PROVIDER_POLICIES[provider]) {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const result = saveProviderKey(userId, provider, apiKey, diagnosticsModel, autofixModel);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // --- Delete key ---
  if (action === 'delete') {
    const { keyId } = body;
    if (!keyId) {
      return new Response(JSON.stringify({ error: 'keyId is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const deleted = deleteProviderKey(userId, keyId);
    if (!deleted) {
      return new Response(JSON.stringify({ error: 'Key not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Validate key ---
  if (action === 'validate') {
    const { provider } = body;
    if (!provider) {
      return new Response(JSON.stringify({ error: 'provider is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await validateKey(userId, provider);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Update model preferences ---
  if (action === 'update_preferences') {
    const { provider, diagnosticsModel, autofixModel, platformFallback } = body;
    if (!provider) {
      return new Response(JSON.stringify({ error: 'provider is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { eq, and } = await import('drizzle-orm');

    const db = getDb();
    const existing = db.select().from(schema.aiProviderKeys)
      .where(and(
        eq(schema.aiProviderKeys.userId, userId),
        eq(schema.aiProviderKeys.provider, provider),
      ))
      .get();

    if (!existing) {
      return new Response(JSON.stringify({ error: 'No key saved for this provider' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const updates: any = { updatedAt: new Date() };
    if (diagnosticsModel !== undefined) updates.diagnosticsModel = diagnosticsModel;
    if (autofixModel !== undefined) updates.autofixModel = autofixModel;
    if (platformFallback !== undefined) updates.platformFallback = platformFallback;

    db.update(schema.aiProviderKeys)
      .set(updates)
      .where(and(
        eq(schema.aiProviderKeys.id, existing.id),
        eq(schema.aiProviderKeys.userId, userId),
      ))
      .run();

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
};
