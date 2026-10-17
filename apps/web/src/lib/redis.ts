import "server-only";
import Redis from "ioredis";

const g = globalThis as unknown as { __asapRedis?: Redis; __asapLocks?: Map<string, number> };

/**
 * Redis is optional. Disabled when REDIS_URL is set but empty, or unset on Vercel / in production
 * (the localhost default exists for local dev only). When disabled no client is ever constructed:
 * cache = pass-through, rate limit = in-memory, locks = per-instance (DB row locks / unique constraints are the real guards).
 */
export function resolveRedisUrl(e: NodeJS.ProcessEnv = process.env): string | null {
  const url = e.REDIS_URL?.trim();
  if (url) return url;
  if (e.REDIS_URL !== undefined || e.VERCEL || e.NODE_ENV === "production") return null;
  return "redis://localhost:6379";
}

const redisUrl = resolveRedisUrl();
export const redisEnabled = redisUrl !== null;

function create(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    connectTimeout: 3000,
  });
  client.on("error", (err) => {
    if (process.env.NODE_ENV !== "test") console.warn("[redis]", err.message);
  });
  return client;
}

function disabled(): never {
  throw new Error("redis disabled");
}

/**
 * Singleton ioredis client. With Redis disabled it is a stub whose commands reject immediately (no connection, no timeout);
 * every consumer already treats a Redis error as "degrade gracefully".
 */
export const redis: Redis = redisUrl
  ? (g.__asapRedis ?? create(redisUrl))
  : (new Proxy({}, { get: () => async () => disabled() }) as unknown as Redis);
if (redisUrl && process.env.NODE_ENV !== "production") g.__asapRedis = redis;

/** Per-instance fallback lock (serverless: only guards double submits that hit the same instance). */
function acquireLocalLock(key: string, ttlMs: number): null | (() => Promise<void>) {
  const locks = (g.__asapLocks ??= new Map());
  const now = Date.now();
  const until = locks.get(key);
  if (until !== undefined && until > now) return null;
  const mine = now + ttlMs;
  locks.set(key, mine);
  return async () => {
    if (locks.get(key) === mine) locks.delete(key);
  };
}

/**
 * Distributed lock (SET NX PX). Returns a release fn or null if the lock is held.
 * Use for webhook idempotency, order fulfillment, etc.
 */
export async function acquireLock(key: string, ttlMs = 30_000): Promise<null | (() => Promise<void>)> {
  if (!redisEnabled) return acquireLocalLock(key, ttlMs);
  const token = crypto.randomUUID();
  const lockKey = `lock:${key}`;
  try {
    const ok = await redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (ok !== "OK") return null;
  } catch {
    // Redis down: degrade to "lock acquired" (DB unique constraints remain the real guard)
    return async () => {};
  }
  return async () => {
    try {
      await redis.eval(`if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`, 1, lockKey, token);
    } catch {
      /* ignore */
    }
  };
}

export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const release = await acquireLock(key, ttlMs);
  if (!release) return null;
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** Tiny JSON cache helper. */
export async function cached<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
  if (!redisEnabled) return loader();
  try {
    const hit = await redis.get(`cache:${key}`);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* fall through */
  }
  const value = await loader();
  try {
    await redis.set(`cache:${key}`, JSON.stringify(value), "EX", ttlSec);
  } catch {
    /* ignore */
  }
  return value;
}
