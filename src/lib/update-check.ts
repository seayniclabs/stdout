/**
 * Update check — store.seayniclabs.com updates API.
 * Offline-first: network failure never locks the app.
 */

import { getLicenseKeyForUpdateCheck, touchLicenseCheckedAt, verifyLicenseSignature, isSignedLicense } from './license';

const CURRENT_VERSION = import.meta.env.STDOUT_VERSION || process.env.STDOUT_VERSION || '1.1.0';
const STORE_UPDATE_URL =
  process.env.STORE_UPDATE_URL || 'https://store.seayniclabs.com/api/updates/stdout-self-host/stable';
const STORE_PRODUCT_URL = 'https://store.seayniclabs.com/products/stdout-self-host';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  /** @deprecated use subscriptionActive — true when subscription_active or lifetime */
  licenseValid?: boolean;
  licenseMessage?: string;
  subscriptionActive: boolean;
  entitledVersion: string | null;
  lifetime: boolean;
  fileHash: string | null;
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
  if (!licenseKey) {
    licenseNotice = {
      valid: false,
      message: 'No license key configured. Add your key in Settings to check for updates.',
    };
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(STORE_UPDATE_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-License-Key': licenseKey,
        'X-Current-Version': CURRENT_VERSION,
      },
    });
    clearTimeout(timeout);

    if (res.status === 401) {
      // Before showing an error, check if the local signature is valid.
      // This supports offline installs and air-gapped environments where the
      // store can't be reached or the key isn't registered there yet.
      if (isSignedLicense(licenseKey)) {
        const localCheck = verifyLicenseSignature(licenseKey);
        if (localCheck.valid) {
          licenseNotice = null;
          const localValid: UpdateCheckResult = {
            hasUpdate: false,
            currentVersion: CURRENT_VERSION,
            latestVersion: CURRENT_VERSION,
            releaseUrl: STORE_PRODUCT_URL,
            licenseValid: true,
            subscriptionActive: false,
            entitledVersion: null,
            lifetime: false,
            fileHash: null,
          };
          cachedResult = localValid;
          cachedAt = Date.now();
          return localValid;
        }
      }

      let errMsg = 'Invalid or expired license key.';
      try {
        const err = await res.json() as { error?: string; reason?: string };
        errMsg = err.error || err.reason || errMsg;
      } catch { /* ignore */ }
      licenseNotice = { valid: false, message: errMsg };
      const invalid: UpdateCheckResult = {
        hasUpdate: false,
        currentVersion: CURRENT_VERSION,
        latestVersion: CURRENT_VERSION,
        releaseUrl: STORE_PRODUCT_URL,
        licenseValid: false,
        licenseMessage: errMsg,
        subscriptionActive: false,
        entitledVersion: null,
        lifetime: false,
        fileHash: null,
      };
      cachedResult = invalid;
      cachedAt = Date.now();
      return invalid;
    }

    if (!res.ok) return null;

    const data = await res.json() as {
      update_available?: boolean;
      latest_version?: string | null;
      download_url?: string | null;
      file_hash?: string | null;
      subscription_active?: boolean;
      entitled_version?: string | null;
      lifetime?: boolean;
      message?: string | null;
    };

    touchLicenseCheckedAt();

    const lifetime = data.lifetime === true;
    const subscriptionActive = lifetime || data.subscription_active === true;
    const latestVersion = data.latest_version || CURRENT_VERSION;

    licenseNotice = null;
    if (!subscriptionActive && !lifetime && data.message) {
      licenseNotice = { valid: false, message: data.message };
    }

    const result: UpdateCheckResult = {
      hasUpdate: data.update_available ?? isNewer(latestVersion, CURRENT_VERSION),
      currentVersion: CURRENT_VERSION,
      latestVersion,
      releaseUrl: data.download_url || STORE_PRODUCT_URL,
      licenseValid: subscriptionActive,
      licenseMessage: data.message || undefined,
      subscriptionActive,
      entitledVersion: data.entitled_version ?? null,
      lifetime,
      fileHash: data.file_hash ?? null,
    };

    cachedResult = result;
    cachedAt = Date.now();
    return result;
  } catch {
    return null;
  }
}
