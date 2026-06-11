import { eq } from 'drizzle-orm';
import { getCentralDb, centralSchema } from './db';

// SL-<base64url>.<base64url> — signed format (current)
const SIGNED_KEY_RE = /^SL-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// XXXX-XXXX-XXXX-XXXX — legacy segment format
const LEGACY_KEY_RE = /^[A-Z0-9]{2,8}(-[A-Z0-9]{4,32}){1,}$/i;

export function isValidLicenseKeyFormat(key: string): boolean {
  const trimmed = key.trim();
  return SIGNED_KEY_RE.test(trimmed) || (trimmed.length >= 16 && trimmed.length <= 128 && LEGACY_KEY_RE.test(trimmed));
}

export function getStoredLicense() {
  return getCentralDb().select().from(centralSchema.license).limit(1).get() ?? null;
}

export function getLicenseKeyForUpdateCheck(): string | null {
  return getStoredLicense()?.key ?? null;
}

export function storeLicense(key: string, email: string, edition = 'self-host'): void {
  const now = new Date();
  getCentralDb().delete(centralSchema.license).run();
  getCentralDb().insert(centralSchema.license).values({
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
  getCentralDb().update(centralSchema.license)
    .set({ lastCheckedAt: new Date() })
    .where(eq(centralSchema.license.key, row.key))
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
import crypto from 'node:crypto';

// Embedded public key for offline license verification
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
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

// Compact wire format (new keys use short field names)
interface CompactPayload {
  e?: string;  // email
  i?: number;  // issued
  x?: number;  // expires
  m?: number;  // maxActivations
  // Legacy long-form fields
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
 * Verify a cryptographically signed license offline.
 * No network call required - uses embedded public key.
 */
export function verifyLicenseSignature(
  signedKey: string
): { valid: boolean; payload?: LicensePayload; reason?: string } {
  // Format: SL-{base64url(payload)}.{base64url(signature)}
  if (!signedKey.startsWith('SL-')) {
    return { valid: false, reason: 'Invalid license format' };
  }

  const parts = signedKey.slice(3).split('.');
  if (parts.length !== 2) {
    // Could be legacy format SL-XXXX-YYYY - check if it has exactly 2 dashes
    const dashCount = (signedKey.match(/-/g) || []).length;
    if (dashCount === 2) {
      return { valid: false, reason: 'Legacy license format - requires online validation' };
    }
    return { valid: false, reason: 'Invalid license format' };
  }

  const [payloadB64, signatureB64] = parts;

  try {
    // Verify RSA-SHA256 signature
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(payloadB64);
    verify.end();

    const isValid = verify.verify(PUBLIC_KEY_PEM, signatureB64, 'base64url');
    if (!isValid) {
      return { valid: false, reason: 'Invalid signature - license may be tampered or fake' };
    }

    // Decode and parse payload — supports both compact (e/i/x/m) and legacy (email/issued/expires/maxActivations) field names
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const raw: CompactPayload = JSON.parse(payloadJson);
    const payload = normalizePayload(raw);

    // Validate payload structure
    if (!payload.email || !payload.issued) {
      return { valid: false, reason: 'Invalid license payload structure' };
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.expires && now > payload.expires) {
      const expiredDate = new Date(payload.expires * 1000).toLocaleDateString();
      return { valid: false, reason: `License expired on ${expiredDate}` };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'License verification failed: ' + (err as Error).message };
  }
}

/**
 * Check if license format is signed (new) or legacy (old).
 */
export function isSignedLicense(key: string): boolean {
  if (!key.startsWith('SL-')) return false;
  const parts = key.slice(3).split('.');
  return parts.length === 2; // New format has payload.signature
}

/**
 * Validates StdOut license on app startup.
 * Checks database-stored license and validates signature.
 * Production-only - dev mode bypasses check.
 */
export async function validateLicenseAtStartup(): Promise<{ valid: boolean; error?: string }> {
  // Skip in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('[License] Development mode - skipping validation');
    return { valid: true };
  }

  // Check for stored license in database
  const stored = getStoredLicense();
  if (!stored) {
    return {
      valid: false,
      error: 'No license activated. Please activate your license in Settings.',
    };
  }

  // Validate signature
  const verification = verifyLicenseSignature(stored.key);
  if (!verification.valid) {
    return {
      valid: false,
      error: verification.reason || 'License validation failed',
    };
  }

  console.log(`[License] Valid license for ${verification.payload?.email}`);
  return { valid: true };
}

/**
 * Prints license validation error and exits process.
 * Called at app startup if no valid license found.
 */
export function exitWithLicenseError(error: string): never {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  StdOut License Required');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');
  console.error(`  Error: ${error}`);
  console.error('');
  console.error('  Purchase a license at: https://stdout.io/pricing');
  console.error('  Activate in Settings after installation');
  console.error('  Support: support@stdout.io');
  console.error('');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}
