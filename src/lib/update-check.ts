/**
 * Update check — contacts stdout.seayniclabs.com with version + license key.
 * Offline-first: network failure never locks the app.
 */

import { getLicenseKeyForUpdateCheck, touchLicenseCheckedAt } from './license';

const CURRENT_VERSION = import.meta.env.STDOUT_VERSION || process.env.STDOUT_VERSION || '1.1.0';
const UPDATE_URL = 'https://stdout.seayniclabs.com/api/updates';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  licenseValid?: boolean;
  licenseMessage?: string;
}

let cachedResult: UpdateCheckResult | null = null;
let cachedAt = 0;

let licenseNotice: { valid: boolean; message: string } | null = null;

export function getLicenseNotice(): { valid: boolean; message: string } | null {
  return licenseNotice;
}

function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const licenseKey = getLicenseKeyForUpdateCheck();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(UPDATE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: CURRENT_VERSION,
        licenseKey: licenseKey || undefined,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json() as {
      version?: string;
      latestVersion?: string;
      updateAvailable?: boolean;
      releaseUrl?: string;
      licenseValid?: boolean;
      message?: string;
    };

    touchLicenseCheckedAt();

    const latestVersion = data.latestVersion || data.version || CURRENT_VERSION;
    const currentVersion: string = CURRENT_VERSION;

    if (data.licenseValid === false) {
      licenseNotice = {
        valid: false,
        message: data.message || 'Your license could not be verified — visit stdout.seayniclabs.com to reactivate.',
      };
    } else {
      licenseNotice = null;
    }

    const result: UpdateCheckResult = {
      hasUpdate: data.updateAvailable ?? isNewer(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: data.releaseUrl || 'https://stdout.seayniclabs.com',
      licenseValid: data.licenseValid ?? true,
      licenseMessage: data.message,
    };

    cachedResult = result;
    cachedAt = Date.now();
    return result;
  } catch {
    return null;
  }
}
