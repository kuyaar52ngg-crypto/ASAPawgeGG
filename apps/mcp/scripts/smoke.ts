/**
 * End-to-end smoke test of the MCP server using the official SDK client.
 *   ASAP_API_KEY=ak_live_… MCP_URL=http://localhost:3333/mcp pnpm --filter @asap/mcp smoke
 * Lists tools/resources/prompts and calls read-only tools. Pass --buy to also place a real balance order for the first in-stock product.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL ?? `http://localhost:${process.env.MCP_PORT ?? 3333}/mcp`;
const key = process.env.ASAP_API_KEY;
if (!key) {
  console.error("Set ASAP_API_KEY");
  process.exit(2);
}

const client = new Client({ name: "asap-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));

const text = (r: unknown) => ((r as { content?: { type: string; text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("");
const json = (r: unknown) => JSON.parse(text(r)) as Record<string, any>;

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
const resources = await client.listResources();
console.log("resources:", resources.resources.map((r) => r.uri).join(", "));
const prompts = await client.listPrompts();
console.log("prompts:", prompts.prompts.map((p) => p.name).join(", "));

const names = new Set(tools.tools.map((t) => t.name));
let ok = true;
const check = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  ok &&= cond;
};

if (names.has("search_products")) {
  const found = json(await client.callTool({ name: "search_products", arguments: { query: "spotify", pageSize: 3 } }));
  check("search_products", Array.isArray(found.items) && found.items.length > 0, `${found.items?.length ?? 0} items`);
  const first = found.items?.[0];
  if (first && names.has("get_product")) {
    const p = json(await client.callTool({ name: "get_product", arguments: { productId: first.id } }));
    check("get_product", p.id === first.id, p.title);
  }
}
if (names.has("list_categories")) check("list_categories", Array.isArray(json(await client.callTool({ name: "list_categories", arguments: {} }))) || text(await client.callTool({ name: "list_categories", arguments: {} })).includes("slug"));
if (names.has("get_balance")) check("get_balance", typeof json(await client.callTool({ name: "get_balance", arguments: {} })).balance === "number");
if (names.has("list_my_orders")) check("list_my_orders", Array.isArray(json(await client.callTool({ name: "list_my_orders", arguments: {} })).items));
if (resources.resources.length) {
  const r = await client.readResource({ uri: resources.resources[0]!.uri });
  check("read categories resource", (r.contents[0] as { text?: string }).text?.includes("slug") ?? false);
}
if (prompts.prompts.length) {
  const pr = await client.getPrompt({ name: "buy-assistant", arguments: { request: "подписка Spotify" } });
  check("buy-assistant prompt", pr.messages.length > 0);
}
const denied = await client.callTool({ name: "admin_metrics", arguments: {} }).then(
  (r) => (r as { isError?: boolean }).isError === true,
  () => true,
);
if (!names.has("admin_metrics")) check("admin tool hidden / denied for this key", denied);

await client.close();
process.exit(ok ? 0 : 1);
