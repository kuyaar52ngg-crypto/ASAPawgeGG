import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { API_SCOPES, ROLE_SCOPES } from "@asap/shared";
import { ApiError, type AsapApiClient } from "./api-client";
import { TOOLS, createOrderInput, errorResult, humanizeMoney, rub, sellerProductInput, toKopecks, toolsFor } from "./tools";

const names = (scopes: readonly string[]) => toolsFor({ scopes: [...scopes] }).map((t) => t.name);

describe("tool catalogue", () => {
  it("has the 12 documented tools with unique names and valid scopes", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      ["admin_metrics", "admin_moderate_product", "create_order", "get_balance", "get_order_status", "get_product", "list_categories", "list_my_orders", "search_products", "seller_create_product", "seller_stats", "seller_upload_stock"].sort(),
    );
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) expect((API_SCOPES as readonly string[]).includes(t.scope)).toBe(true);
  });

  it("exposes tools by role scopes (buyer < seller < admin)", () => {
    const user = names(ROLE_SCOPES.USER);
    const seller = names(ROLE_SCOPES.SELLER);
    const admin = names(ROLE_SCOPES.ADMIN);
    expect(user).toContain("create_order");
    expect(user).not.toContain("seller_create_product");
    expect(user).not.toContain("admin_metrics");
    expect(seller).toEqual(expect.arrayContaining(["seller_create_product", "seller_upload_stock", "seller_stats"]));
    expect(seller).not.toContain("admin_moderate_product");
    expect(admin).toHaveLength(TOOLS.length);
    expect(names(["catalog:read"]).sort()).toEqual(["get_product", "list_categories", "search_products"]);
    expect(names([])).toEqual([]);
  });

  it("tools with required arguments reject empty input, the others accept it", () => {
    const needsArgs = ["create_order", "get_product", "get_order_status", "seller_create_product", "seller_upload_stock", "admin_moderate_product"];
    for (const t of TOOLS) {
      const ok = z.object(t.input).safeParse({}).success;
      expect({ name: t.name, ok }).toEqual({ name: t.name, ok: !needsArgs.includes(t.name) });
    }
  });
});

describe("create_order input", () => {
  const item = { productId: "p1", quantity: 1 };
  it("requires explicit purchase confirmation", () => {
    expect(createOrderInput.safeParse({ items: [item] }).success).toBe(false);
    expect(createOrderInput.safeParse({ items: [item], confirmPurchase: false }).success).toBe(false);
    expect(createOrderInput.safeParse({ items: [item], confirmPurchase: true }).success).toBe(true);
  });
  it("bounds quantities and item count", () => {
    expect(createOrderInput.safeParse({ items: [{ ...item, quantity: 0 }], confirmPurchase: true }).success).toBe(false);
    expect(createOrderInput.safeParse({ items: [{ ...item, quantity: 51 }], confirmPurchase: true }).success).toBe(false);
    expect(createOrderInput.safeParse({ items: [], confirmPurchase: true }).success).toBe(false);
  });

  it("maps to the REST body (rubles -> kopecks) and always sends an Idempotency-Key", async () => {
    const createOrder = vi.fn(async () => ({ id: "o1", total: 149900 }));
    const tool = TOOLS.find((t) => t.name === "create_order")!;
    const res = (await tool.run({ api: { createOrder } as unknown as AsapApiClient, me: { userId: "u", name: null, role: "USER", scopes: [], keyPrefix: "" } }, { items: [{ productId: "p1", variantId: "v1", quantity: 2, amountRub: 1500.5 }], confirmPurchase: true })) as { total: number; totalRub: string };
    const [body, idem] = createOrder.mock.calls[0] as unknown as [{ items: { amountKopecks: number; variantId: string }[] }, string];
    expect(body.items[0]).toMatchObject({ productId: "p1", variantId: "v1", quantity: 2, amountKopecks: 150050 });
    expect(idem).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.totalRub).toContain("1 499");
  });

  it("does not call the API when confirmation is missing", async () => {
    const createOrder = vi.fn();
    const tool = TOOLS.find((t) => t.name === "create_order")!;
    await expect(tool.run({ api: { createOrder } as unknown as AsapApiClient, me: { userId: "u", name: null, role: "USER", scopes: [], keyPrefix: "" } }, { items: [{ productId: "p1", quantity: 1 }] })).rejects.toThrow();
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe("seller_create_product input", () => {
  const base = { title: "Spotify Premium 12 мес", categoryId: "c1", type: "SUBSCRIPTION", deliveryMode: "AUTO_STOCK", description: "x".repeat(40), priceRub: 1990 };
  it("validates and defaults to draft", () => {
    const r = sellerProductInput.parse(base);
    expect(r.submitForModeration).toBe(false);
  });
  it("rejects short descriptions and unknown delivery modes", () => {
    expect(sellerProductInput.safeParse({ ...base, description: "short" }).success).toBe(false);
    expect(sellerProductInput.safeParse({ ...base, deliveryMode: "AUTO_PROVIDER" }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("converts money", () => {
    expect(toKopecks(199.99)).toBe(19999);
    expect(toKopecks(0.1 + 0.2)).toBe(30);
    expect(rub(150000)).toContain("1 500");
  });
  it("humanizeMoney adds ₽ strings next to kopecks recursively", () => {
    const out = humanizeMoney({ items: [{ price: 19900, oldPrice: null, title: "x" }], total: 500, count: 3 }) as unknown as { items: { priceRub: string }[]; totalRub: string; countRub?: string };
    expect(out.items[0]!.priceRub).toContain("199");
    expect(out.totalRub).toContain("5");
    expect(out.countRub).toBeUndefined();
  });
  it("errorResult turns API errors into readable, actionable text", () => {
    const r = errorResult(new ApiError(402, "insufficient_funds", "Недостаточно средств на балансе"));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("insufficient_funds");
    expect(r.content[0]!.text).toContain("/account/topup");
  });
});
