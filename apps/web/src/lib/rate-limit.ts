import "server-only";
import { redis } from "./redis";

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** seconds until the window resets */
  retryAfter: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed-window rate limiter on Redis (falls back to in-process memory when Redis is down).
 * @example const rl = await rateLimit({ key: `login:${ip}`, limit: 10, windowSec: 60 }); if (!rl.ok) ...
 */
export async function rateLimit(opts: { key: string; limit: number; windowSec: number }): Promise<RateLimitResult> {
  const { key, limit, windowSec } = opts;
  const k = `rl:${key}`;
  try {
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSec);
    const ttl = await redis.ttl(k);
    return { ok: count <= limit, limit, remaining: Math.max(0, limit - count), retryAfter: ttl > 0 ? ttl : windowSec };
  } catch {
    const now = Date.now();
    const cur = memory.get(k);
    if (!cur || cur.resetAt <= now) {
      memory.set(k, { count: 1, resetAt: now + windowSec * 1000 });
      return { ok: true, limit, remaining: limit - 1, retryAfter: windowSec };
    }
    cur.count += 1;
    return { ok: cur.count <= limit, limit, remaining: Math.max(0, limit - cur.count), retryAfter: Math.ceil((cur.resetAt - now) / 1000) };
  }
}
