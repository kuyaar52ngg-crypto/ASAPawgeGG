import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "@asap/shared";
import { effectiveScopes, extractApiKey, hasScope, keyRejection, minRole } from "./core";

const h = (init: Record<string, string>) => ({ get: (n: string) => init[n.toLowerCase()] ?? null });

describe("api key extraction", () => {
  const { key } = generateApiKey();

  it("reads Bearer and X-API-Key", () => {
    expect(extractApiKey(h({ authorization: `Bearer ${key}` }))).toBe(key);
    expect(extractApiKey(h({ authorization: `bearer   ${key} ` }))).toBe(key);
    expect(extractApiKey(h({ "x-api-key": key }))).toBe(key);
  });

  it("rejects malformed values", () => {
    expect(extractApiKey(h({}))).toBeNull();
    expect(extractApiKey(h({ authorization: "Bearer abc" }))).toBeNull();
    expect(extractApiKey(h({ authorization: `Basic ${key}` }))).toBeNull();
    expect(extractApiKey(h({ authorization: `Bearer ${key}x` }))).toBeNull();
  });

  it("generates verifiable key material (hash only is stored)", () => {
    const g = generateApiKey();
    expect(g.key.startsWith("ak_live_")).toBe(true);
    expect(g.prefix).toBe(g.key.slice(0, 16));
    expect(g.hash).toBe(hashApiKey(g.key));
    expect(g.hash).not.toContain(g.key);
  });
});

describe("roles and scopes", () => {
  it("effective role is the lower of key role and user role", () => {
    expect(minRole("ADMIN", "USER")).toBe("USER");
    expect(minRole("SELLER", "ADMIN")).toBe("SELLER");
    expect(minRole("USER", "USER")).toBe("USER");
  });

  it("scopes are intersected with the role's allowance", () => {
    const all = ["catalog:read", "orders:read", "orders:create", "seller:products", "admin:metrics"];
    expect(effectiveScopes(all, "USER")).toEqual(["catalog:read", "orders:read", "orders:create"]);
    expect(effectiveScopes(all, "SELLER")).toContain("seller:products");
    expect(effectiveScopes(all, "SELLER")).not.toContain("admin:metrics");
    expect(effectiveScopes(all, "ADMIN")).toContain("admin:metrics");
    expect(effectiveScopes(["bogus"], "ADMIN")).toEqual([]);
  });

  it("hasScope requires every scope", () => {
    expect(hasScope(["catalog:read"], "catalog:read")).toBe(true);
    expect(hasScope(["catalog:read"], ["catalog:read", "orders:read"])).toBe(false);
  });
});

describe("keyRejection", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  it("flags revoked, expired and banned owners", () => {
    expect(keyRejection({ revokedAt: new Date(), expiresAt: null, userBanned: false }, now)).toBe("revoked");
    expect(keyRejection({ revokedAt: null, expiresAt: new Date("2026-01-09T00:00:00Z"), userBanned: false }, now)).toBe("expired");
    expect(keyRejection({ revokedAt: null, expiresAt: null, userBanned: true }, now)).toBe("banned");
    expect(keyRejection({ revokedAt: null, expiresAt: new Date("2026-02-01T00:00:00Z"), userBanned: false }, now)).toBeNull();
  });
});
