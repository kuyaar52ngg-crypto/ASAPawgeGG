import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * MCP server factory. Zone F (AI+MCP+API) owns apps/mcp and implements the real tools:
 * search_products, get_product, create_order, get_order_status, list_my_orders,
 * seller_create_product, seller_upload_stock, seller_stats, admin_metrics, admin_moderate_product.
 * Auth: API key (Authorization: Bearer ak_live_...) -> forwards to web REST API /api/v1/*.
 * Foundation ships only `ping` so the transports can be verified.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: "asapawge-gg", version: "0.1.0" });

  server.registerTool(
    "ping",
    { title: "Ping", description: "Проверка доступности MCP-сервера ASAPawge GG", inputSchema: { message: z.string().optional() } },
    async ({ message }) => ({ content: [{ type: "text", text: `pong${message ? `: ${message}` : ""}` }] }),
  );

  return server;
}
