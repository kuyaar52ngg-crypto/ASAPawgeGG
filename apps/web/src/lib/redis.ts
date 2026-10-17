import "server-only";
import Redis from "ioredis";

const g = globalThis as unknown as { __asapRedis?: Redis };

function create(): Redis {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
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

/** Singleton ioredis client. */
export const redis: Redis = g.__asapRedis ?? create();
if (process.env.NODE_ENV !== "production") g.__asapRedis = redis;

/**
 * Distributed lock (SET NX PX). Returns a release fn or null if the lock is held.
 * Use for webhook idempotency, order fulfillment, etc.
 */
export async function acquireLock(key: string, ttlMs = 30_000): Promise<null | (() => Promise<void>)> {
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
