/**
 * Rate Limiting Middleware
 *
 * Prevents abuse of public endpoints using in-memory rate limiting.
 * For production, consider Redis-backed rate limiting for multi-instance deployments.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests per window
}

// Default: 100 requests per 15 minutes
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
};

/**
 * Check if request exceeds rate limit
 * @param identifier - Unique identifier (IP address, user ID, etc.)
 * @param config - Rate limit configuration (optional)
 * @returns true if rate limited, false if allowed
 */
export function isRateLimited(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // Clean up expired entries periodically
  if (Math.random() < 0.01) {
    cleanupExpiredEntries(now);
  }

  if (!entry || now > entry.resetAt) {
    // New window
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return false;
  }

  if (entry.count >= config.maxRequests) {
    return true;  // Rate limited
  }

  // Increment counter
  entry.count++;
  rateLimitStore.set(identifier, entry);
  return false;
}

/**
 * Get rate limit headers for response
 */
export function getRateLimitHeaders(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): Record<string, string> {
  const entry = rateLimitStore.get(identifier);
  const now = Date.now();

  if (!entry || now > entry.resetAt) {
    return {
      'X-RateLimit-Limit': String(config.maxRequests),
      'X-RateLimit-Remaining': String(config.maxRequests - 1),
      'X-RateLimit-Reset': String(Math.floor((now + config.windowMs) / 1000)),
    };
  }

  const remaining = Math.max(0, config.maxRequests - entry.count);
  return {
    'X-RateLimit-Limit': String(config.maxRequests),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.floor(entry.resetAt / 1000)),
  };
}

/**
 * Clean up expired rate limit entries
 */
function cleanupExpiredEntries(now: number): void {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Get client identifier from request
 */
export function getClientIdentifier(request: Request): string {
  // Try X-Forwarded-For first (behind proxy)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // Fallback to direct connection (will be 127.0.0.1 in Docker)
  const url = new URL(request.url);
  return url.hostname || 'unknown';
}
