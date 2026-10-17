import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type AsapApiClient, type Me } from "./api-client";
import { SERVER_NAME, SERVER_VERSION } from "./config";
import { errorResult, okResult, toolsFor } from "./tools";

export const CATEGORIES_URI = "asapawge://categories";

export const BUY_ASSISTANT_TEXT = (request: string, budgetRub?: string) =>
  `Ты помогаешь пользователю купить цифровой товар на ASAPawge GG. Запрос: «${request}»${budgetRub ? `; бюджет: ${budgetRub} ₽` : ""}.
Порядок действий:
1. Вызови search_products (при необходимости несколько запросов), выбери 2–3 подходящих варианта.
2. Для выбранного товара вызови get_product: проверь наличие (inStock), регион/платформу и варианты. Если есть requiresInput (steamLogin/buyerInput) — спроси у пользователя эти данные.
3. Вызови get_balance и сравни с итоговой суммой. Если денег не хватает — сообщи и предложи пополнить баланс на сайте (/account/topup), не покупай.
4. Покажи пользователю товар, вариант, регион и итоговую цену, и дождись явного «да».
5. Только после подтверждения вызови create_order с confirmPurchase=true.
6. Покажи результат: номер заказа, статус и ключ (items[].delivery.secrets). Если статус ещё не DELIVERED — вызови get_order_status через несколько секунд.
Никогда не покупай без подтверждения и не выдумывай товары, которых нет в ответах инструментов.`;

/**
 * Builds an MCP server for ONE authenticated caller: tools are registered per the key's scopes (a buyer key
 * never sees seller/admin tools); every tool call is forwarded to the REST API with the caller's own key.
 */
export function createServer(api: AsapApiClient, me: Me): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: `ASAPawge GG — маркетплейс цифровых товаров (суммы в рублях). Вы вошли как ${me.role}. Покупки списывают реальный баланс: всегда запрашивайте подтверждение пользователя перед create_order.` },
  );

  for (const tool of toolsFor(me)) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: tool.annotations }, async (args: Record<string, unknown>) => {
      try {
        return okResult(await tool.run({ api, me }, args));
      } catch (e) {
        return errorResult(e);
      }
    });
  }

  if (me.scopes.includes("catalog:read")) {
    server.registerResource("categories", CATEGORIES_URI, { title: "Категории каталога", description: "Дерево категорий ASAPawge GG (id, slug, название)", mimeType: "application/json" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api.categories(), null, 2) }],
    }));
  }

  server.registerPrompt(
    "buy-assistant",
    { title: "Помощник покупки", description: "Подобрать товар в каталоге и безопасно купить его с баланса — с подтверждением пользователя", argsSchema: { request: z.string().min(2).describe("Что нужно купить, например «подписка Spotify на год»"), budgetRub: z.string().optional().describe("Максимальный бюджет в рублях") } },
    ({ request, budgetRub }) => ({ messages: [{ role: "user", content: { type: "text", text: BUY_ASSISTANT_TEXT(request, budgetRub) } }] }),
  );

  return server;
}
