// Self-hosted StdOut — single tier, everything unlocked.

export type TierName = 'selfhost';

export interface TierLimits {
  maxStacks: number;
  maxIncidentsPerMonth: number;
  maxDocsStorageMB: number;
  maxMonitors: number;
  aiModel: 'haiku' | 'sonnet';
  backupsEnabled: boolean;
  templatesEnabled: boolean;
  maxSeats: number;
  rbacEnabled: boolean;
  publicStatusPages: boolean;
  weeklyDigest: boolean;
}

const SELFHOST_LIMITS: TierLimits = {
  maxStacks: Infinity,
  maxIncidentsPerMonth: Infinity,
  maxDocsStorageMB: Infinity,
  maxMonitors: Infinity,
  aiModel: 'sonnet',
  backupsEnabled: true,
  templatesEnabled: true,
  maxSeats: Infinity,
  rbacEnabled: true,
  publicStatusPages: true,
  weeklyDigest: true,
};

export function getEffectiveTier(_subscriptionStatus?: string, _subscriptionTier?: string | null, role?: string): TierName {
  if (role === 'superadmin') return 'selfhost';
  return 'selfhost';
}

export function getTierLimits(_tier: TierName = 'selfhost'): TierLimits {
  return SELFHOST_LIMITS;
}

export function getUserLimits(user: { role: string }): { tier: TierName; limits: TierLimits } {
  const tier = getEffectiveTier(undefined, undefined, user.role);
  return { tier, limits: getTierLimits(tier) };
}

export function getUpgradeUrl(): string {
  return 'https://stdout.seayniclabs.com';
}
