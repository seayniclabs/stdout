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
