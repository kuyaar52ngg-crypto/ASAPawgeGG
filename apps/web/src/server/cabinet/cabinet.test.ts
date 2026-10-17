import { describe, expect, it } from "vitest";
import { parseCsvFirstColumn } from "@/components/cabinet/csv";
import { buildTimeline } from "@/components/cabinet/order-timeline";
import { isAllowedImageUrl } from "./images";
import { maskPayoutDetails } from "./payouts";
import { productFormSchema } from "./product-schema";
import { templateDescription } from "./describe";
import { maskSecret } from "./stock";

describe("parseCsvFirstColumn", () => {
  it("takes the first column, handles quotes, separators and a header row", () => {
    expect(parseCsvFirstColumn("key,note\nAAA-111,first\n\"BBB,222\",\"x\"\r\nCCC-333;third\n")).toEqual(["AAA-111", "BBB,222", "CCC-333"]);
  });
  it("keeps a single value that looks like a header and ignores blank lines", () => {
    expect(parseCsvFirstColumn("code")).toEqual(["code"]);
    expect(parseCsvFirstColumn("\n\nK1\n\nK2")).toEqual(["K1", "K2"]);
  });
});

describe("masking", () => {
  it("never reveals a whole secret", () => {
    expect(maskSecret("ABCD-EFGH-IJKL")).toBe("ABCD••••••JKL");
    expect(maskSecret("abc")).toBe("a•••••");
    expect(maskSecret("login:pass")).not.toContain("pass");
  });
  it("masks payout details", () => {
    expect(maskPayoutDetails("CARD", { card: "4111111111111111" })).toBe("•••• 1111");
    expect(maskPayoutDetails("YOOMONEY", { wallet: "41001234567890" })).toBe("•••7890");
    expect(maskPayoutDetails("USDT", { network: "TRC20", address: "TXyz1234567890abcdefghijklmnop" })).toMatch(/^TRC20 TXyz1…mnop$/);
    expect(maskPayoutDetails("CARD", null)).toBe("—");
  });
});

describe("image allow-list", () => {
  it("accepts only https URLs on hosts configured for next/image", () => {
    expect(isAllowedImageUrl("https://picsum.photos/seed/a/600/800")).toBe(true);
    expect(isAllowedImageUrl("http://picsum.photos/a.png")).toBe(false);
    expect(isAllowedImageUrl("https://evil.example.com/a.png")).toBe(false);
    expect(isAllowedImageUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedImageUrl("not a url")).toBe(false);
  });
});

describe("productFormSchema", () => {
  const ok = { title: "Game Key", categoryId: "cat1", type: "KEY", deliveryMode: "AUTO_STOCK", description: "x".repeat(40), price: 10_000, intent: "draft" };
  it("accepts a minimal valid product and applies defaults", () => {
    const r = productFormSchema.safeParse(ok);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ images: [], tags: [], variants: [], instructions: "" });
  });
  it("rejects bad prices, AUTO_PROVIDER, Steam top-ups and foreign images", () => {
    expect(productFormSchema.safeParse({ ...ok, price: 50 }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...ok, price: 12.5 }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...ok, deliveryMode: "AUTO_PROVIDER" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...ok, type: "TOPUP", platform: "STEAM" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...ok, images: ["https://evil.example.com/x.png"] }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...ok, oldPrice: 9_000 }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...ok, variants: [{ title: "a", price: 500, isActive: false }] }).success).toBe(false);
  });
});

describe("templateDescription", () => {
  it("builds a labelled Russian fallback description", () => {
    const r = templateDescription({ title: "Cyberpunk 2077", type: "KEY", deliveryMode: "AUTO_STOCK", platform: "STEAM", region: "RU" });
    expect(r.source).toBe("template");
    expect(r.description).toContain("Cyberpunk 2077");
    expect(r.description).toContain("Steam");
    expect(r.shortDescription!.length).toBeLessThanOrEqual(240);
  });
});

describe("buildTimeline", () => {
  const d = (n: number) => new Date(2026, 9, n);
  const base = { createdAt: d(1), paidAt: d(1), deliveredAt: d(2), cancelledAt: null, updatedAt: d(3), disputes: [] };
  it("walks created -> paid -> delivered", () => {
    expect(buildTimeline({ ...base, status: "DELIVERED" }).map((s) => s.label)).toEqual(["Заказ создан", "Оплачен", "Товар выдан"]);
  });
  it("shows pending and cancelled orders without a payment step", () => {
    expect(buildTimeline({ ...base, status: "PENDING", paidAt: null, deliveredAt: null }).map((s) => s.state)).toEqual(["done", "current", "todo"]);
    expect(buildTimeline({ ...base, status: "CANCELLED", paidAt: null, deliveredAt: null, cancelledAt: d(2) }).at(-1)).toMatchObject({ label: "Заказ отменён", state: "bad" });
  });
  it("adds dispute and refund steps", () => {
    const steps = buildTimeline({ ...base, status: "REFUNDED", disputes: [{ createdAt: d(2), status: "RESOLVED_REFUND", resolvedAt: d(3) }] });
    expect(steps.map((s) => s.label)).toEqual(["Заказ создан", "Оплачен", "Товар выдан", "Открыт спор", "Спор решён: возврат", "Средства возвращены на баланс"]);
  });
  it("marks an in-progress manual order as current", () => {
    expect(buildTimeline({ ...base, status: "PROCESSING", deliveredAt: null }).at(-1)).toMatchObject({ label: "Идёт выдача", state: "current" });
  });
});
