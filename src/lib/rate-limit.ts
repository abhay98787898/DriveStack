type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastCleanupAt = 0;

/**
 * Process-local fixed-window limiter for this single-instance, self-hosted app.
 * For multi-instance deployments, replace with a shared store (e.g. Redis).
 */
export function checkRateLimit(
  identity: string,
  scope: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  if (now - lastCleanupAt > 60_000) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    lastCleanupAt = now;
  }

  const key = `${scope}:${identity}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: 0,
  };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return {
    success: false,
    error: 'Too many requests. Please slow down and try again.',
    retry_after_seconds: retryAfterSeconds,
  };
}
