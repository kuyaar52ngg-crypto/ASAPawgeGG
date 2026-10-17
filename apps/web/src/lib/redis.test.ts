import { describe, expect, it } from "vitest";
import { resolveRedisUrl } from "./redis";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("resolveRedisUrl", () => {
  it("uses REDIS_URL when set", () => {
    expect(resolveRedisUrl(env({ REDIS_URL: " redis://r:6379 ", VERCEL: "1" }))).toBe("redis://r:6379");
  });
  it("is disabled by an empty REDIS_URL", () => {
    expect(resolveRedisUrl(env({ REDIS_URL: "" }))).toBeNull();
  });
  it("is disabled on Vercel and in production when unset", () => {
    expect(resolveRedisUrl(env({ VERCEL: "1" }))).toBeNull();
    expect(resolveRedisUrl(env({ NODE_ENV: "production" }))).toBeNull();
  });
  it("defaults to localhost for local dev only", () => {
    expect(resolveRedisUrl(env({ NODE_ENV: "development" }))).toBe("redis://localhost:6379");
  });
});
