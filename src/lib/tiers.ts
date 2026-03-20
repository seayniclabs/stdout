// Tier definitions and limit enforcement for StdOut subscriptions.
// Tiers: free (default), solo ($12/mo), shop ($24/mo), self-host ($79 one-time)

export type TierName = 'free' | 'solo' | 'shop' | 'self-host';

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

const TIER_LIMITS: Record<TierName, TierLimits> = {
  free: {
    maxStacks: 1,
    maxIncidentsPerMonth: 10,
    maxDocsStorageMB: 100,
    maxMonitors: 3,
    aiModel: 'haiku',
    backupsEnabled: false,
    templatesEnabled: false,
    maxSeats: 1,
    rbacEnabled: false,
    publicStatusPages: false,
    weeklyDigest: false,
  },
  solo: {
    maxStacks: Infinity,
    maxIncidentsPerMonth: Infinity,
    maxDocsStorageMB: 1024,
    maxMonitors: 25,
    aiModel: 'sonnet',
    backupsEnabled: true,
    templatesEnabled: true,
    maxSeats: 1,
    rbacEnabled: false,
    publicStatusPages: true,
    weeklyDigest: true,
  },
  shop: {
    maxStacks: Infinity,
    maxIncidentsPerMonth: Infinity,
    maxDocsStorageMB: 5120,
    maxMonitors: 100,
    aiModel: 'sonnet',
    backupsEnabled: true,
    templatesEnabled: true,
    maxSeats: 5,
    rbacEnabled: true,
    publicStatusPages: true,
    weeklyDigest: true,
  },
  'self-host': {
    maxStacks: Infinity,
    maxIncidentsPerMonth: Infinity,
    maxDocsStorageMB: Infinity,
    maxMonitors: Infinity,
    aiModel: 'sonnet',
    backupsEnabled: true,
    templatesEnabled: true,
    maxSeats: 1,
    rbacEnabled: false,
    publicStatusPages: true,
    weeklyDigest: true,
  },
};

/**
 * Resolve the effective tier for a user based on their subscription status and tier.
 * Superadmins always get full access.
 */
export function getEffectiveTier(
  subscriptionStatus: string,
  subscriptionTier: string | null,
  role?: string
): TierName {
  // Superadmins bypass all limits
  if (role === 'superadmin') return 'self-host';

  // Active subscription → use their tier
  if (subscriptionStatus === 'active' || subscriptionStatus === 'past_due') {
    const tier = subscriptionTier as TierName;
    if (tier && TIER_LIMITS[tier]) return tier;
    return 'solo'; // fallback if tier is missing but status is active
  }

  return 'free';
}

/**
 * Get the limits for a tier.
 */
export function getTierLimits(tier: TierName): TierLimits {
  return TIER_LIMITS[tier];
}

/**
 * Get limits for a user based on their session data.
 */
export function getUserLimits(user: {
  subscriptionStatus: string;
  subscriptionTier: string | null;
  role: string;
}): { tier: TierName; limits: TierLimits } {
  const tier = getEffectiveTier(user.subscriptionStatus, user.subscriptionTier, user.role);
  return { tier, limits: getTierLimits(tier) };
}

/**
 * Store upgrade URL — points to the store product page.
 */
export function getUpgradeUrl(targetTier?: TierName): string {
  switch (targetTier) {
    case 'solo':
      return 'https://store.seayniclabs.com/products/stdout-solo';
    case 'shop':
      return 'https://store.seayniclabs.com/products/stdout-shop';
    case 'self-host':
      return 'https://store.seayniclabs.com/products/stdout-self-host';
    default:
      return 'https://store.seayniclabs.com/products/stdout-solo';
  }
}
