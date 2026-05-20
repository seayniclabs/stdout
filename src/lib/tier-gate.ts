import type { TierName } from './tiers';
import type { SessionUser } from './auth';

export interface GateResult {
  allowed: boolean;
  tier: TierName;
  error?: string;
  upgradeUrl?: string;
}

export function tierBlockedResponse(message: string, tier: TierName): Response {
  return new Response(JSON.stringify({ error: message, tier }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function checkFeature(_user: SessionUser, _feature: keyof import('./tiers').TierLimits): GateResult {
  return { allowed: true, tier: 'selfhost' };
}

export function checkCountLimit(
  _user: SessionUser,
  _limitKey: 'maxStacks' | 'maxIncidentsPerMonth' | 'maxMonitors' | 'maxDocsStorageMB',
  _currentCount: number,
  _label: string,
): GateResult {
  return { allowed: true, tier: 'selfhost' };
}
