import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import crypto from 'node:crypto';

// SL-<base64url>.<base64url> — signed format
const SIGNED_KEY_RE = /^SL-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// SL-DEV-* — development/testing keys (no signature verification)
const DEV_KEY_RE = /^SL-DEV-[A-Za-z0-9_-]+$/;
// XXXX-XXXX-XXXX-XXXX — legacy segment format
const LEGACY_KEY_RE = /^[A-Z0-9]{2,8}(-[A-Z0-9]{4,32}){1,}$/i;

export function isValidLicenseKeyFormat(key: string): boolean {
  const trimmed = key.trim();
  return SIGNED_KEY_RE.test(trimmed) || DEV_KEY_RE.test(trimmed) || (trimmed.length >= 16 && trimmed.length <= 128 && LEGACY_KEY_RE.test(trimmed));
}

export function getStoredLicense() {
  return getDb().select().from(schema.license).limit(1).get() ?? null;
}

export function getLicenseKeyForUpdateCheck(): string | null {
  return getStoredLicense()?.key ?? null;
}

export function storeLicense(key: string, email: string, edition = 'self-host'): void {
  const now = new Date();
  getDb().delete(schema.license).run();
  getDb().insert(schema.license).values({
    key: key.trim(),
    email: email.trim(),
    edition,
    activatedAt: now,
    lastCheckedAt: null,
  }).run();
}

export function touchLicenseCheckedAt(): void {
  const row = getStoredLicense();
  if (!row) return;
  getDb().update(schema.license)
    .set({ lastCheckedAt: new Date() })
    .where(eq(schema.license.key, row.key))
    .run();
}

export function hasValidLicense(): boolean {
  return !!getStoredLicense();
}

export function requireLicense(): { valid: false; message: string } | { valid: true } {
  const license = getStoredLicense();
  if (!license) {
    return {
      valid: false,
      message: 'This feature requires a valid license. Please activate your license in Settings.',
    };
  }
  return { valid: true };
}

// Ed25519 public key — verifies all SL- keys issued from 2026-06-11 onward
const ED25519_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEActdpqlMQUnc3ObmJXZTVhrJdIXwjsZVzjLl33HxMOwY=
-----END PUBLIC KEY-----`;

// RSA-4096 public key — kept for backward compat with any pre-Ed25519 keys
const RSA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAqml6Jvswz/YQOxsw+ipo
YP60nMaqAMJZJbbbjmq7qKZPkkWOuC1NIfTx5y9MM9ULjeVXGmcL19d/AZ0T2mvC
+977g1KBP6cf4cj+xSmSGvpELAO+wpFZOmnnYEsIrNE8xMnk9SftMtYkbuFgFUJh
0Ze8StslLstlbJZUCAOrTOcwGn3DPZDHRZSDFQ+PlSgFOoCxau2LotWMxTpyIcWm
CtV/HTjkIcftunSF9o3scqEilwD9Z/yxuDVUXtfTsHHyj5JysdbR68KpDQQ7ETsl
PjnDE6dSUcJpSxyJo7WlgBeQlXQE5E8hMTN5rJ2d2hbb+Znn+tA0KQKT27tGwrQm
OMGrZiPvthrgpfpQy+Gzj8Zl8GxNxZBZqmwYvtAYY6+mwH32DEutA8+ffQLT5lrq
TR32lMbjyr7xpLmwkut2JX4r38FLD0aav9t3vvHGZNQp/4PFowsO8GSRpyu2WHjC
nZu3hGhf3MUH3V5B3GMH/P18PdVzfuzxry++M+OUFwpB8AFFZCHH1IeGl3k3pBls
EYtOdTfUKXgO1mzUn/xzXLkgVRwTcD8177qc+TjgiuH4vjZ7Mznd6AYxLnZsU/1t
mUsSL37+laA0Ats3L/B3GepcraOuXluV/0YbkAEIFzNkuA64apLeDoH4FmKvfisD
v0orsvF3/0gETuC17zRFFB0CAwEAAQ==
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  product: string;
  email: string;
  issued: number;
  expires: number | null;
  maxActivations: number;
}

// Compact wire format — short field names keep key length minimal
interface CompactPayload {
  e?: string;            // email
  i?: number;            // issued (unix secs)
  x?: number;            // expires (unix secs)
  m?: number;            // maxActivations
  // Legacy long-form fields (RSA-era keys)
  product?: string;
  email?: string;
  issued?: number;
  expires?: number | null;
  maxActivations?: number;
}

function normalizePayload(raw: CompactPayload): LicensePayload {
  return {
    product: raw.product ?? 'stdout-self-host',
    email: raw.e ?? raw.email ?? '',
    issued: raw.i ?? raw.issued ?? 0,
    expires: raw.x ?? raw.expires ?? null,
    maxActivations: raw.m ?? raw.maxActivations ?? 1,
  };
}

/**
 * Verify a signed license offline — no network call needed.
 * Tries Ed25519 first (short keys), falls back to RSA for legacy keys.
 * Also accepts Store legacy format: SL-{CODE}-{NANOID} (validated by format only, no signature).
 */
export function verifyLicenseSignature(
  signedKey: string
): { valid: boolean; payload?: LicensePayload; reason?: string } {
  if (!signedKey.startsWith('SL-')) {
    return { valid: false, reason: 'Invalid license format' };
  }

  // Dev keys: SL-DEV-* (for development/testing, no signature verification)
  if (signedKey.startsWith('SL-DEV-')) {
    return {
      valid: true,
      payload: {
        product: 'stdout-self-host',
        email: 'dev@seayniclabs.com',
        issued: Math.floor(Date.now() / 1000),
        expires: null,
        maxActivations: 999,
      },
    };
  }

  const parts = signedKey.slice(3).split('.');
  if (parts.length !== 2) {
    const dashCount = (signedKey.match(/-/g) || []).length;
    // Store legacy format: SL-{CODE}-{NANOID} (2 dashes total)
    // Accept this as valid - it was purchased from the Store
    if (dashCount === 2 && /^SL-[A-Z0-9]{3,4}-[A-Za-z0-9_-]{20,}$/.test(signedKey)) {
      // Legacy Store license - accept as valid (already purchased)
      return {
        valid: true,
        payload: {
          product: 'stdout-self-host',
          email: 'licensed-user@seayniclabs.com', // Placeholder - real email stored separately
          issued: Math.floor(Date.now() / 1000),
          expires: null, // Legacy licenses don't expire
          maxActivations: 99,
        },
      };
    }
    return { valid: false, reason: 'Invalid license format' };
  }

  const [payloadB64, signatureB64] = parts;
  const sigBytes = Buffer.from(signatureB64, 'base64url');

  try {
    // Ed25519 signatures are exactly 64 bytes — try that first
    let isValid = false;
    if (sigBytes.length === 64) {
      isValid = crypto.verify(null, Buffer.from(payloadB64), ED25519_PUBLIC_KEY_PEM, sigBytes);
    }

    // Fall back to RSA-SHA256 for longer signatures (legacy keys)
    if (!isValid && sigBytes.length > 64) {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(payloadB64);
      verify.end();
      isValid = verify.verify(RSA_PUBLIC_KEY_PEM, signatureB64, 'base64url');
    }

    if (!isValid) {
      return { valid: false, reason: 'Invalid signature - license may be tampered or fake' };
    }

    const raw: CompactPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const payload = normalizePayload(raw);

    if (!payload.email || !payload.issued) {
      return { valid: false, reason: 'Invalid license payload' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.expires && now > payload.expires) {
      return { valid: false, reason: `License expired on ${new Date(payload.expires * 1000).toLocaleDateString()}` };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'License verification failed: ' + (err as Error).message };
  }
}

export function isSignedLicense(key: string): boolean {
  if (!key.startsWith('SL-')) return false;
  return key.slice(3).split('.').length === 2;
}

export async function validateLicenseAtStartup(): Promise<{ valid: boolean; error?: string }> {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[License] Development mode - skipping validation');
    return { valid: true };
  }

  const stored = getStoredLicense();
  if (!stored) {
    return { valid: false, error: 'No license activated. Please activate your license in Settings.' };
  }

  const verification = verifyLicenseSignature(stored.key);
  if (!verification.valid) {
    return { valid: false, error: verification.reason || 'License validation failed' };
  }

  console.log(`[License] Valid license for ${verification.payload?.email}`);
  return { valid: true };
}

export function exitWithLicenseError(error: string): never {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  StdOut License Required');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(`  Error: ${error}`);
  console.error('  Activate your license in Settings');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}
