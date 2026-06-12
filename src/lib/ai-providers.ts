/**
 * AI Provider Management — BYOK (Bring Your Own Key)
 *
 * Self-hosted only. Users configure their own API keys for AI diagnostics
 * and (future) auto-fix. Platform key remains as a fallback for diagnostics.
 *
 * Provider policies are hardcoded — no table needed for 3 providers.
 */

import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { getTenantDb, tenantSchema } from './db';
import { eq, and, desc } from 'drizzle-orm';
import { encrypt, decrypt } from './crypto';

// --- Provider Policies (hardcoded, no table) ---

export type ProviderState = 'certified' | 'beta' | 'blocked';

export interface ProviderPolicy {
  id: string;
  name: string;
  state: ProviderState;
  diagnosticsEnabled: boolean;
  autofixEnabled: boolean;
  models: { id: string; name: string; capability: 'diagnostics' | 'autofix' | 'both' }[];
  testEndpoint: string; // URL to call for validation
}

export const PROVIDER_POLICIES: Record<string, ProviderPolicy> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    state: 'certified',
    diagnosticsEnabled: true,
    autofixEnabled: true,
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', capability: 'both' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', capability: 'diagnostics' },
      { id: 'claude-opus-4-6-20250618', name: 'Claude Opus 4.6', capability: 'both' },
    ],
    testEndpoint: 'https://api.anthropic.com/v1/messages',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    state: 'certified',
    diagnosticsEnabled: true,
    autofixEnabled: true,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', capability: 'both' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capability: 'diagnostics' },
      { id: 'o3-mini', name: 'o3-mini', capability: 'both' },
    ],
    testEndpoint: 'https://api.openai.com/v1/models',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    state: 'beta',
    diagnosticsEnabled: true,
    autofixEnabled: false,
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capability: 'diagnostics' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', capability: 'diagnostics' },
    ],
    testEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
  },
};

// --- Policy Resolver ---

export function canUseDiagnostics(providerId: string): boolean {
  const policy = PROVIDER_POLICIES[providerId];
  if (!policy) return false;
  return policy.state !== 'blocked' && policy.diagnosticsEnabled;
}

export function canUseAutofix(providerId: string): boolean {
  const policy = PROVIDER_POLICIES[providerId];
  if (!policy) return false;
  return policy.state === 'certified' && policy.autofixEnabled;
}

export function isSelfHosted(): boolean {
  return process.env.STDOUT_MODE !== 'saas';
}

export function getAvailableProviders(): ProviderPolicy[] {
  return Object.values(PROVIDER_POLICIES).filter(p => p.state !== 'blocked');
}

// --- Key Fingerprint ---

function fingerprint(apiKey: string): string {
  // First 4 + last 4 characters with hash in between
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
  const prefix = apiKey.slice(0, 4);
  const suffix = apiKey.slice(-4);
  return `${prefix}...${hash}...${suffix}`;
}

// --- Key CRUD ---

export function saveProviderKey(
  userId: string,
  providerId: string,
  apiKey: string,
  diagnosticsModel?: string,
  autofixModel?: string,
): { id: string; fingerprint: string } {
  const policy = PROVIDER_POLICIES[providerId];
  if (!policy || policy.state === 'blocked') {
    throw new Error(`Provider ${providerId} is not available`);
  }

  const db = getTenantDb(userId);
  const now = new Date();
  const fp = fingerprint(apiKey);
  const encryptedKey = encrypt(apiKey);

  // Check for existing key for this provider
  const existing = db.select().from(tenantSchema.aiProviderKeys)
    .where(and(
      eq(tenantSchema.aiProviderKeys.userId, userId),
      eq(tenantSchema.aiProviderKeys.provider, providerId),
    ))
    .get();

  if (existing) {
    db.update(tenantSchema.aiProviderKeys)
      .set({
        encryptedApiKey: encryptedKey,
        keyFingerprint: fp,
        status: 'active',
        diagnosticsModel: diagnosticsModel || existing.diagnosticsModel,
        autofixModel: autofixModel || existing.autofixModel,
        updatedAt: now,
      })
      .where(eq(tenantSchema.aiProviderKeys.id, existing.id))
      .run();
    return { id: existing.id, fingerprint: fp };
  }

  const id = nanoid();
  db.insert(tenantSchema.aiProviderKeys).values({
    id,
    userId,
    provider: providerId,
    encryptedApiKey: encryptedKey,
    keyFingerprint: fp,
    status: 'active',
    diagnosticsModel: diagnosticsModel || policy.models[0]?.id || null,
    autofixModel: autofixModel || null,
    platformFallback: true,
    createdAt: now,
    updatedAt: now,
  }).run();

  return { id, fingerprint: fp };
}

export function listProviderKeys(userId: string) {
  const db = getTenantDb(userId);
  return db.select({
    id: tenantSchema.aiProviderKeys.id,
    provider: tenantSchema.aiProviderKeys.provider,
    keyFingerprint: tenantSchema.aiProviderKeys.keyFingerprint,
    status: tenantSchema.aiProviderKeys.status,
    diagnosticsModel: tenantSchema.aiProviderKeys.diagnosticsModel,
    autofixModel: tenantSchema.aiProviderKeys.autofixModel,
    platformFallback: tenantSchema.aiProviderKeys.platformFallback,
    lastValidatedAt: tenantSchema.aiProviderKeys.lastValidatedAt,
    createdAt: tenantSchema.aiProviderKeys.createdAt,
    updatedAt: tenantSchema.aiProviderKeys.updatedAt,
  }).from(tenantSchema.aiProviderKeys)
    .where(eq(tenantSchema.aiProviderKeys.userId, userId))
    .all();
}

export function deleteProviderKey(userId: string, keyId: string): boolean {
  const db = getTenantDb(userId);
  const result = db.delete(tenantSchema.aiProviderKeys)
    .where(and(
      eq(tenantSchema.aiProviderKeys.id, keyId),
      eq(tenantSchema.aiProviderKeys.userId, userId),
    ))
    .run();
  return result.changes > 0;
}

export function getDecryptedKey(userId: string, providerId: string): string | null {
  const db = getTenantDb(userId);
  const row = db.select().from(tenantSchema.aiProviderKeys)
    .where(and(
      eq(tenantSchema.aiProviderKeys.userId, userId),
      eq(tenantSchema.aiProviderKeys.provider, providerId),
      eq(tenantSchema.aiProviderKeys.status, 'active'),
    ))
    .get();

  if (!row) return null;
  return decrypt(row.encryptedApiKey);
}

// --- Key Validation ---

export async function validateKey(userId: string, providerId: string): Promise<{ valid: boolean; error?: string }> {
  const apiKey = getDecryptedKey(userId, providerId);
  if (!apiKey) return { valid: false, error: 'No active key found' };

  const policy = PROVIDER_POLICIES[providerId];
  if (!policy) return { valid: false, error: 'Unknown provider' };

  const db = getTenantDb(userId);
  const now = new Date();

  try {
    let valid = false;

    if (providerId === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      // 200 = valid, 401 = invalid key, anything else = might be rate limit (still valid)
      valid = res.status === 200 || (res.status !== 401 && res.status !== 403);
    } else if (providerId === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      valid = res.status === 200;
    } else if (providerId === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        signal: AbortSignal.timeout(10000),
      });
      valid = res.status === 200;
    }

    // Update validation status
    db.update(tenantSchema.aiProviderKeys)
      .set({
        status: valid ? 'active' : 'invalid',
        lastValidatedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(tenantSchema.aiProviderKeys.userId, userId),
        eq(tenantSchema.aiProviderKeys.provider, providerId),
      ))
      .run();

    return { valid, error: valid ? undefined : 'API key validation failed' };
  } catch (err: any) {
    db.update(tenantSchema.aiProviderKeys)
      .set({ status: 'invalid', lastValidatedAt: now, updatedAt: now })
      .where(and(
        eq(tenantSchema.aiProviderKeys.userId, userId),
        eq(tenantSchema.aiProviderKeys.provider, providerId),
      ))
      .run();

    return { valid: false, error: err.message || 'Connection failed' };
  }
}

// --- Credential Router ---

export interface ResolvedCredential {
  // 'ollama' = local model Seaynic provides (the default + floor). 'user_key' = optional BYOK add-on.
  source: 'user_key' | 'ollama';
  provider: string;
  model: string;
  apiKey: string; // empty string for ollama (no key needed)
}

/**
 * Resolve which credential to use for diagnostics.
 * Priority: user key (if configured + valid) → platform key (fallback).
 */
export function resolveForDiagnostics(userId: string, tier: 'free' | 'paid'): ResolvedCredential | null {
  const db = getTenantDb(userId);

  // Check for active user keys (prefer Anthropic, then others)
  const userKeys = db.select().from(tenantSchema.aiProviderKeys)
    .where(and(
      eq(tenantSchema.aiProviderKeys.userId, userId),
      eq(tenantSchema.aiProviderKeys.status, 'active'),
    ))
    .all();

  for (const key of userKeys) {
    if (!canUseDiagnostics(key.provider)) continue;

    const apiKey = decrypt(key.encryptedApiKey);
    if (!apiKey) continue;

    const model = key.diagnosticsModel || PROVIDER_POLICIES[key.provider]?.models[0]?.id;
    if (!model) continue;

    return {
      source: 'user_key',
      provider: key.provider,
      model,
      apiKey,
    };
  }

  // No usable BYOK key → fall back to LOCAL OLLAMA. Ollama is what Seaynic provides — the default
  // and the floor. BYOK is an optional power add-on, never a requirement (Charlie 2026-06-12).
  // There is no Seaynic-hosted "platform key": a self-host instance is fully self-contained.
  const ollamaModel = tier === 'paid'
    ? (process.env.OBSERVATORY_ANALYST_MODEL || 'qwen2.5:14b-instruct-q4_K_M')
    : (process.env.OBSERVATORY_WATCHER_MODEL || 'llama3.2:3b-instruct-q4_K_M');
  return {
    source: 'ollama',
    provider: 'ollama',
    model: ollamaModel,
    apiKey: '', // local — no key
  };
}

// --- Audit ---

export function logAudit(
  userId: string,
  incidentId: string | null,
  capability: 'diagnostics' | 'autofix_plan' | 'autofix_apply',
  provider: string,
  model: string,
  credentialSource: 'user_key' | 'ollama',
  outcome: 'success' | 'failed' | 'blocked',
  failureReason?: string,
): void {
  const db = getTenantDb(userId);
  db.insert(tenantSchema.aiExecutionAudit).values({
    id: nanoid(),
    userId,
    incidentId,
    capability,
    provider,
    model,
    credentialSource,
    outcome,
    failureReason: failureReason || null,
    createdAt: new Date(),
  }).run();
}
