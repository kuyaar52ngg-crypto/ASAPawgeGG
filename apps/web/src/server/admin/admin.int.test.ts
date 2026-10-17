/**
 * Integration tests for zone D admin services against a REAL seeded PostgreSQL (same gating as commerce.int.test.ts):
 * skipped unless INTEGRATION_DATABASE_URL is set — it mutates data, never point it at a database you care about.
 * Run: `bash scripts/test-int.sh`.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

// The admin services only need the role-check helpers' types; keep Auth.js (and next/server) out of the unit-test graph.
vi.mock("@/server/auth/session", () => ({
  AuthError: class AuthError extends Error {
    code = "FORBIDDEN";
  },
  assertRole: vi.fn(),
}));
vi.mock("@/lib/request", () => ({ getClientIp: async () => "127.0.0.1" }));

const URL = process.env.INTEGRATION_DATABASE_URL;
const d = describe.skipIf(!URL);

type AdminCtx = import("./action").AdminCtx;
let prisma: typeof import("@asap/db").prisma;
let users: typeof import("./users");
let settings: typeof import("./settings");
let ctx: AdminCtx;
let targetId: string;

d("admin services (real DB)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.STOCK_ENCRYPTION_KEY ??= "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=";
    ({ prisma } = await import("@asap/db"));
    users = await import("./users");
    settings = await import("./settings");
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@asapawge.gg" } });
    ctx = { admin: { id: admin.id, email: admin.email, role: "ADMIN" } as AdminCtx["admin"], ip: "127.0.0.1" };
    targetId = (await prisma.user.findUniqueOrThrow({ where: { email: "user@asapawge.gg" } })).id;
  });

  it("credits and debits a balance through a balanced ledger posting + audit row", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).balance;
    const credit = await users.adjustUserBalance(ctx, { userId: targetId, direction: "credit", amount: "100,50", memo: "int-test credit" });
    expect(credit.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).balance).toBe(before + 10_050);
    const debit = await users.adjustUserBalance(ctx, { userId: targetId, direction: "debit", amount: "100.50", memo: "int-test debit" });
    expect(debit.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).balance).toBe(before);
    const audits = await prisma.auditLog.count({ where: { actorId: ctx.admin.id, action: "user.balance_adjust", entityId: targetId } });
    expect(audits).toBeGreaterThanOrEqual(2);
  });

  it("refuses to overdraw a balance and rejects invalid amounts", async () => {
    const over = await users.adjustUserBalance(ctx, { userId: targetId, direction: "debit", amount: "9999999", memo: "too much" });
    expect(over.ok).toBe(false);
    const bad = await users.adjustUserBalance(ctx, { userId: targetId, direction: "credit", amount: "abc", memo: "bad amount" });
    expect(bad.ok).toBe(false);
    const zero = await users.adjustUserBalance(ctx, { userId: targetId, direction: "credit", amount: "0", memo: "zero amount" });
    expect(zero.ok).toBe(false);
  });

  it("guards self-service role/ban changes and requires a ban reason", async () => {
    expect((await users.setUserRole(ctx, { userId: ctx.admin.id, role: "USER" })).ok).toBe(false);
    expect((await users.setUserBan(ctx, { userId: ctx.admin.id, banned: true, reason: "x" })).ok).toBe(false);
    expect((await users.setUserBan(ctx, { userId: targetId, banned: true })).ok).toBe(false);
  });

  it("bans and unbans with audit entries", async () => {
    expect((await users.setUserBan(ctx, { userId: targetId, banned: true, reason: "int-test" })).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).banned).toBe(true);
    expect((await users.setUserBan(ctx, { userId: targetId, banned: false })).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).banned).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: { in: ["user.ban", "user.unban"] }, entityId: targetId } })).toBeGreaterThanOrEqual(2);
  });

  it("validates and persists settings, writing an audit record", async () => {
    const original = await settings.loadSettings();
    const bad = await settings.saveSettings(ctx, { section: "commission", values: { commissionPercent: "99", holdDays: 3, steamFeePercent: "4" } });
    expect(bad.ok).toBe(false);
    const res = await settings.saveSettings(ctx, { section: "commission", values: { commissionPercent: "12,5", holdDays: 5, steamFeePercent: "4" } });
    expect(res.ok).toBe(true);
    const now = await settings.loadSettings();
    expect(now.commissionPercent).toBe("12,5");
    expect(now.holdDays).toBe(5);
    // restore
    await settings.saveSettings(ctx, { section: "commission", values: { commissionPercent: original.commissionPercent, holdDays: original.holdDays, steamFeePercent: original.steamFeePercent } });
    expect(await prisma.auditLog.count({ where: { action: "settings.update", entityId: "commission" } })).toBeGreaterThanOrEqual(2);
  });

  it("rejects an invalid Yandex Metrika counter id", async () => {
    expect((await settings.saveSettings(ctx, { section: "analytics", values: { ymId: "abc" } })).ok).toBe(false);
  });
});
