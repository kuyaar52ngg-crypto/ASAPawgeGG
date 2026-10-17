import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ROLE_SCOPES } from "@asap/shared";
import { ApiError, type AsapApiClient, type Me } from "./api-client";
import { createServer } from "./server";

function me(role: Me["role"]): Me {
  return { userId: "u1", name: "T", role, scopes: [...ROLE_SCOPES[role]], keyPrefix: "ak_live_abcd1234" };
}

async function connect(role: Me["role"], api: Partial<AsapApiClient>) {
  const server = createServer(api as AsapApiClient, me(role));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP server over the SDK (in-memory transport)", () => {
  it("lists only the tools the key's role may use", async () => {
    const buyer = await connect("USER", {});
    const names = (await buyer.listTools()).tools.map((t) => t.name);
    expect(names).toContain("search_products");
    expect(names).not.toContain("admin_metrics");
    expect(names).not.toContain("seller_stats");
    const admin = await connect("ADMIN", {});
    expect((await admin.listTools()).tools).toHaveLength(12);
  });

  it("publishes JSON schemas and annotations for tools", async () => {
    const c = await connect("USER", {});
    const order = (await c.listTools()).tools.find((t) => t.name === "create_order")!;
    expect(order.inputSchema.required).toEqual(expect.arrayContaining(["items", "confirmPurchase"]));
    expect(order.annotations?.destructiveHint).toBe(true);
    const search = (await c.listTools()).tools.find((t) => t.name === "search_products")!;
    expect(search.annotations?.readOnlyHint).toBe(true);
  });

  it("forwards search_products to the REST client and adds ₽ strings", async () => {
    const searchProducts = vi.fn(async () => ({ items: [{ id: "p1", title: "Spotify", price: 19900 }], total: 1, page: 1, pageSize: 10, pageCount: 1 }));
    const c = await connect("USER", { searchProducts });
    const res = await c.callTool({ name: "search_products", arguments: { query: "spotify", maxPriceRub: 500 } });
    expect(searchProducts).toHaveBeenCalledWith(expect.objectContaining({ q: "spotify", maxPrice: 50000, pageSize: 10 }));
    const text = (res.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text).items[0].priceRub).toContain("199");
  });

  it("returns API failures as isError results instead of throwing", async () => {
    const createOrder = vi.fn(async () => {
      throw new ApiError(402, "insufficient_funds", "Недостаточно средств на балансе");
    });
    const c = await connect("USER", { createOrder });
    const res = await c.callTool({ name: "create_order", arguments: { items: [{ productId: "p1", quantity: 1 }], confirmPurchase: true } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]!.text).toContain("insufficient_funds");
  });

  it("refuses create_order without confirmPurchase (schema-level) and never calls the API", async () => {
    const createOrder = vi.fn();
    const c = await connect("USER", { createOrder });
    const res = await c.callTool({ name: "create_order", arguments: { items: [{ productId: "p1", quantity: 1 }] } }).catch((e) => ({ isError: true, e }));
    expect(res.isError).toBe(true);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("serves the categories resource and the buy-assistant prompt", async () => {
    const categories = vi.fn(async () => [{ id: "c1", name: "Игры", slug: "games", children: [] }]);
    const c = await connect("USER", { categories });
    const list = await c.listResources();
    expect(list.resources.map((r) => r.uri)).toContain("asapawge://categories");
    const read = await c.readResource({ uri: "asapawge://categories" });
    expect(JSON.parse((read.contents[0] as { text: string }).text)[0].slug).toBe("games");
    const prompt = await c.getPrompt({ name: "buy-assistant", arguments: { request: "Spotify на год", budgetRub: "2000" } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    expect(text).toContain("Spotify на год");
    expect(text).toContain("confirmPurchase=true");
  });
});
