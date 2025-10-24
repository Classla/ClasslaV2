/**
 * Rate Limiting Middleware
 *
 * Implements rate limiting per API key to prevent abuse.
 * Default: 100 requests per minute per API key.
 */

import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// Store rate limit data in memory
// Key: API key hash, Value: { count, resetTime }
const rateLimitStore = new Map<string, RateLimitEntry>();

// Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per window

/**
 * Rate limiting middleware
 *
 * Tracks requests per API key and enforces rate limits.
 * Returns 429 Too Many Requests when limit is exceeded.
 */
export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Get API key from request (set by auth middleware)
  const apiKey = (req as any).apiKey;

  if (!apiKey) {
    // If no API key, skip rate limiting (auth middleware will handle)
    next();
    return;
  }

  const now = Date.now();
  const entry = rateLimitStore.get(apiKey);

  // Initialize or reset if window expired
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(apiKey, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    });

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS.toString());
    res.setHeader(
      "X-RateLimit-Remaining",
      (RATE_LIMIT_MAX_REQUESTS - 1).toString()
    );
    res.setHeader(
      "X-RateLimit-Reset",
      new Date(now + RATE_LIMIT_WINDOW_MS).toISOString()
    );

    next();
    return;
  }

  // Increment counter
  entry.count++;

  // Check if limit exceeded
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

    // Log rate limit violation
    console.warn(
      `Rate limit exceeded for API key: ${apiKey.substring(0, 8)}...`,
      {
        count: entry.count,
        limit: RATE_LIMIT_MAX_REQUESTS,
        resetTime: new Date(entry.resetTime).toISOString(),
        ip: req.ip,
        path: req.path,
        method: req.method,
      }
    );

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS.toString());
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", new Date(entry.resetTime).toISOString());
    res.setHeader("Retry-After", retryAfter.toString());

    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
        retryAfter: retryAfter,
        resetTime: new Date(entry.resetTime).toISOString(),
      },
      timestamp: new Date().toISOString(),
      path: req.path,
    });
    return;
  }

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS.toString());
  res.setHeader(
    "X-RateLimit-Remaining",
    (RATE_LIMIT_MAX_REQUESTS - entry.count).toString()
  );
  res.setHeader("X-RateLimit-Reset", new Date(entry.resetTime).toISOString());

  next();
}

/**
 * Clean up expired entries from the rate limit store
 * Should be called periodically to prevent memory leaks
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Get current rate limit status for an API key
 * Useful for testing and monitoring
 */
export function getRateLimitStatus(apiKey: string): {
  count: number;
  limit: number;
  remaining: number;
  resetTime: Date | null;
} {
  const entry = rateLimitStore.get(apiKey);
  const now = Date.now();

  if (!entry || now > entry.resetTime) {
    return {
      count: 0,
      limit: RATE_LIMIT_MAX_REQUESTS,
      remaining: RATE_LIMIT_MAX_REQUESTS,
      resetTime: null,
    };
  }

  return {
    count: entry.count,
    limit: RATE_LIMIT_MAX_REQUESTS,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count),
    resetTime: new Date(entry.resetTime),
  };
}

/**
 * Reset rate limit for a specific API key
 * Useful for testing
 */
export function resetRateLimit(apiKey: string): void {
  rateLimitStore.delete(apiKey);
}

/**
 * Clear all rate limit data
 * Useful for testing
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

// Set up periodic cleanup (every 5 minutes)
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic cleanup of expired rate limit entries
 */
export function startCleanupInterval(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
  }
}

/**
 * Stop periodic cleanup
 * Useful for testing and graceful shutdown
 */
export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Start cleanup interval automatically
startCleanupInterval();
