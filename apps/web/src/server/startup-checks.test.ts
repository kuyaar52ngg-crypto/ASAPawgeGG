import { describe, expect, it } from "vitest";
import { productionConfigProblems } from "./startup-checks";

const good = {
  AUTH_SECRET: "k3Jx9aP0qW7sLm2VbN8cRtY5uHgFeD1zXoIvCbAaQwE=",
  WORKER_INTERNAL_TOKEN: "f1e2d3c4b5a69788f1e2d3c4b5a69788",
  STOCK_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SANDBOX_WEBHOOK_SECRET: "a-long-unique-sandbox-secret-1234",
} as unknown as NodeJS.ProcessEnv;

describe("productionConfigProblems", () => {
  it("accepts real secrets", () => {
    expect(productionConfigProblems(good)).toEqual([]);
  });
  it("refuses real payments combined with the emulated Steam supplier", () => {
    const risky = { ...good, PLATEGA_MERCHANT_ID: "m", PLATEGA_SECRET: "s", STEAM_TOPUP_PROVIDER: "mock" } as unknown as NodeJS.ProcessEnv;
    expect(productionConfigProblems(risky)).toHaveLength(1);
    expect(productionConfigProblems({ ...risky, STEAM_TOPUP_PROVIDER: "http" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });
  it("rejects the .env.example values and missing keys", () => {
    const bad = {
      AUTH_SECRET: "dev-only-auth-secret-change-me-please-0123456789",
      WORKER_INTERNAL_TOKEN: "dev-internal-token-change-me",
      STOCK_ENCRYPTION_KEY: "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=",
    } as unknown as NodeJS.ProcessEnv;
    expect(productionConfigProblems(bad)).toHaveLength(3);
    expect(productionConfigProblems({} as NodeJS.ProcessEnv)).toHaveLength(3);
  });
});
