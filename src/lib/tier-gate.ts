// Shared tier gating helpers for API routes and pages.

import { getUserLimits, getUpgradeUrl, type TierName } from './tiers';
import type { SessionUser } from './auth';

export interface GateResult {
  allowed: boolean;
  tier: TierName;
  error?: string;
  upgradeUrl?: string;
}

/** JSON 403 response for API routes */
export function tierBlockedResponse(message: string, tier: TierName): Response {
  return new Response(JSON.stringify({
    error: message,
    tier,
    upgradeUrl: getUpgradeUrl(),
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Check a boolean feature gate */
export function checkFeature(user: SessionUser, feature: keyof import('./tiers').TierLimits): GateResult {
  const { tier, limits } = getUserLimits(user);
  const value = limits[feature];
  if (value === false) {
    return { allowed: false, tier, error: `This feature requires a paid plan.`, upgradeUrl: getUpgradeUrl() };
  }
  return { allowed: true, tier };
}

/** Check a count-based limit */
export function checkCountLimit(
  user: SessionUser,
  limitKey: 'maxStacks' | 'maxIncidentsPerMonth' | 'maxMonitors' | 'maxDocsStorageMB',
  currentCount: number,
  label: string
): GateResult {
  const { tier, limits } = getUserLimits(user);
  const max = limits[limitKey];
  if (max !== Infinity && currentCount >= max) {
    return {
      allowed: false,
      tier,
      error: `${label} limit reached (${max} on ${tier} plan).`,
      upgradeUrl: getUpgradeUrl(),
    };
  }
  return { allowed: true, tier };
}
