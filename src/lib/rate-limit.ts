type Entry = { count: number; resetAt: number };

const entries = new Map<string, Entry>();

/** In-memory fallback; use a distributed store in multi-instance deployments. */
export function isRateLimited(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const entry = entries.get(key);
  if (!entry || entry.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}
