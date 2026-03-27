/**
 * Update check — fetches the latest published version from the store
 * and compares it against the local version from package.json.
 *
 * - 5-second timeout, silent failure (never blocks the app)
 * - Caches result for 24 hours in a module-level variable
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const STORE_URL = 'https://store.seayniclabs.com/api/products/stdout-self-host/latest.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5_000;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

let cachedResult: UpdateCheckResult | null = null;
let cachedAt = 0;

/**
 * Compare two semver strings (major.minor.patch).
 * Returns true if remote is newer than local.
 */
function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Check for available updates. Returns the result or null on any error.
 * Cached for 24 hours to avoid hammering the store.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  // Return cached result if still fresh
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(STORE_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json() as { version: string; releaseUrl: string };
    const currentVersion: string = pkg.version;
    const latestVersion = data.version;

    const result: UpdateCheckResult = {
      hasUpdate: isNewer(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: data.releaseUrl || STORE_URL.replace('/api/products/stdout-self-host/latest.json', '/products/stdout-self-host'),
    };

    cachedResult = result;
    cachedAt = Date.now();
    return result;
  } catch {
    // Silent failure — network errors, timeouts, parse errors all return null
    return null;
  }
}
