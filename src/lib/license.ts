import { eq } from 'drizzle-orm';
import { getCentralDb, centralSchema } from './db';

const LICENSE_KEY_RE = /^[A-Z0-9]{2,8}(-[A-Z0-9]{4,32}){1,}$/i;

export function isValidLicenseKeyFormat(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length >= 16 && trimmed.length <= 128 && LICENSE_KEY_RE.test(trimmed);
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
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA1kfX1YlpczPsm6FKlDrr
wAMgjLYYQZZJ5fpUcIL2EpKs2+FQOCL4f3cD4vwH/6ajkLztuyFXNvdI+ljNgtGw
cY9wbk7sgVl2hg+7He2rOq/dipsYJQ4MgRVAstUJkFqcPex8OttZobNbdHXA8V+d
0XLvJZLTvpe5SNduQQySHhAG8plP0uVIThJG9rO8mtXEu+RmnOwlJ8VPMnM05GPb
ckixV6bdJCbyHdZ22QetogMcHLIC9/4OC7lzz/1tIJHliiJvJ7beWMgA3yk5Mq/x
yqlYoIxsMy5tovLnSK04MU7WQRV7ZB1XB9Ng4TrSR/7EN+0dQLcH2ntzEXhsaEzc
54BObkYIPbyrDrtr270k/dMwoVBLfLhCluCRiqG0XPfJqyuosJVhkG5nqYpQbhSG
whp1k5WXt3wCuJSprxGc2QLe0EQwvWmzcd8Htg2dzpiMepVfFdjKXC2dFNfZWt+9
LYDe94454ehEZxh23AwVBdeCPiLTZe0dPtWbzt7mpGFzVtXZgNQ4i6UIiP7C1GkR
tnXDCzq+iWHRE4OTiYwf9kT6+rTAPTFNFwQqsQ8Xrz/o8m7sAxZrayv/mzW7K6RJ
FKsNglbU9u45L/LVVcwIFuGi2po9mXOUUOCRiwRsJR7yUX8TovByrSJhp2bkswsA
0FKTtJ9z77neHhITAFarji8CAwEAAQ==
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  product: string;
  email: string;
  issued: number;
  expires: number | null;
  maxActivations: number;
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

    // Decode and parse payload
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload: LicensePayload = JSON.parse(payloadJson);

    // Validate payload structure
    if (!payload.product || !payload.email || !payload.issued || payload.maxActivations === undefined) {
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
