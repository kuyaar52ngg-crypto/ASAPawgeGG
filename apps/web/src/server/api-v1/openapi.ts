import { z } from "zod";
import { API_SCOPES } from "@asap/shared";
import { createOrderSchema, moderateBodySchema, stockUploadBodySchema } from "./schemas";

/** OpenAPI 3.1 description of REST API v1, served at /api/v1/openapi.json. Request bodies are generated from the same zod schemas the handlers use. */

const json = (schema: unknown) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const envelope = (data: unknown) => ({ type: "object", required: ["ok", "data"], properties: { ok: { const: true }, data } });
const okResp = (description: string, data: unknown) => ({ description, content: json(envelope(data)) });
const errResp = (description: string) => ({ description, content: json(ref("Error")) });
const secured = (scope: string | null) => (scope ? [{ ApiKey: [scope] }, { BearerAuth: [scope] }] : [{ ApiKey: [] }, { BearerAuth: [] }]);
const pathId = (name = "id", description = "Идентификатор") => ({ name, in: "path", required: true, description, schema: { type: "string" } });
const q = (name: string, description: string, schema: unknown = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const std = { "401": errResp("Нет или неверный API-ключ"), "403": errResp("Недостаточно прав (scope/роль)"), "429": errResp("Превышен лимит запросов (см. Retry-After)") };

export function buildOpenApi(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "ASAPawge GG API",
      version: "1.0.0",
      description:
        "REST API маркетплейса цифровых товаров ASAPawge GG. Авторизация — API-ключ из личного кабинета (`Authorization: Bearer ak_live_…` или `X-API-Key`). " +
        "Все суммы — целые числа в копейках (RUB). Ответы: `{ ok: true, data }` или `{ ok: false, error: { code, message, details? } }`. Лимит: 120 запросов в минуту на ключ.",
    },
    servers: [{ url: `${serverUrl.replace(/\/$/, "")}/api/v1` }],
    security: [{ BearerAuth: [] }],
    tags: [{ name: "Каталог" }, { name: "Заказы" }, { name: "Продавец" }, { name: "Администратор" }, { name: "Аккаунт" }],
    paths: {
      "/me": { get: { tags: ["Аккаунт"], summary: "Кто я: роль и права ключа", security: secured(null), responses: { "200": okResp("OK", ref("Me")), ...std } } },
      "/balance": { get: { tags: ["Аккаунт"], summary: "Баланс сайта", description: "Нужен scope `orders:read`.", security: secured("orders:read"), responses: { "200": okResp("Баланс в копейках", { type: "object", properties: { balance: { type: "integer" }, currency: { const: "RUB" } } }), ...std } } },
      "/categories": { get: { tags: ["Каталог"], summary: "Дерево категорий", security: secured("catalog:read"), responses: { "200": okResp("OK", { type: "array", items: ref("Category") }), ...std } } },
      "/products": {
        get: {
          tags: ["Каталог"],
          summary: "Поиск и список товаров",
          security: secured("catalog:read"),
          parameters: [
            q("q", "Поиск по названию (устойчив к опечаткам и раскладке)"),
            q("category", "slug категории"),
            q("platform", "STEAM, XBOX, PLAYSTATION, ..."),
            q("region", "Регион активации"),
            q("type", "KEY | ACCOUNT | SUBSCRIPTION | TOPUP | GIFT_CARD | CURRENCY | SERVICE", { type: "string" }),
            q("minPrice", "Минимальная цена, копейки", { type: "integer" }),
            q("maxPrice", "Максимальная цена, копейки", { type: "integer" }),
            q("inStock", "1 — только в наличии"),
            q("sort", "popular | new | price_asc | price_desc | rating | discount | relevance"),
            q("page", "Страница (с 1)", { type: "integer" }),
            q("pageSize", "Размер страницы, до 60", { type: "integer" }),
          ],
          responses: { "200": okResp("Страница товаров", ref("ProductPage")), ...std },
        },
      },
      "/products/{id}": { get: { tags: ["Каталог"], summary: "Товар по id или slug", security: secured("catalog:read"), parameters: [pathId("id", "id или slug товара")], responses: { "200": okResp("OK", ref("ProductDetail")), "404": errResp("Не найден"), ...std } } },
      "/orders": {
        get: {
          tags: ["Заказы"],
          summary: "Мои заказы",
          security: secured("orders:read"),
          parameters: [q("status", "PENDING | PAID | PROCESSING | DELIVERED | DISPUTED | REFUNDED | CANCELLED | FAILED"), q("page", "Страница", { type: "integer" }), q("pageSize", "До 50", { type: "integer" })],
          responses: { "200": okResp("Страница заказов (без выданного содержимого)", { type: "object", properties: { items: { type: "array", items: ref("Order") }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" }, pageCount: { type: "integer" } } }), ...std },
        },
        post: {
          tags: ["Заказы"],
          summary: "Создать заказ и оплатить с баланса",
          description: "Резервирует товар, списывает баланс атомарно и запускает выдачу. Если выдача завершилась за несколько секунд, ключи уже в ответе (`items[].delivery.secrets`). Заголовок `Idempotency-Key` делает повтор безопасным.",
          security: secured("orders:create"),
          parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 120 } }],
          requestBody: { required: true, content: json(z.toJSONSchema(createOrderSchema)) },
          responses: { "201": okResp("Заказ создан и оплачен", ref("OrderWithDelivery")), "200": okResp("Повтор по Idempotency-Key", ref("OrderWithDelivery")), "402": errResp("Недостаточно средств"), "409": errResp("Нет в наличии"), "422": errResp("Ошибка валидации / товар недоступен"), ...std },
        },
      },
      "/orders/{id}": { get: { tags: ["Заказы"], summary: "Заказ по id или номеру (AG-…) с выданным содержимым", security: secured("orders:read"), parameters: [pathId("id", "id или номер заказа")], responses: { "200": okResp("OK", ref("OrderWithDelivery")), "404": errResp("Не найден"), ...std } } },
      "/seller/products": {
        post: {
          tags: ["Продавец"],
          summary: "Создать товар (черновик или на модерацию)",
          description: "Тело — форма товара из кабинета продавца. `intent: \"submit\"` отправляет на модерацию (только VERIFIED-продавцы). Изображения — https с разрешённых хостов.",
          security: secured("seller:products"),
          requestBody: { required: true, content: json(ref("ProductInput")) },
          responses: { "201": okResp("Создан", { type: "object", properties: { id: { type: "string" }, status: { type: "string" }, queued: { type: "boolean" }, message: { type: "string" } } }), "422": errResp("Ошибка валидации"), ...std },
        },
      },
      "/seller/products/{id}/stock": {
        post: { tags: ["Продавец"], summary: "Загрузить ключи на склад", security: secured("seller:stock"), parameters: [pathId()], requestBody: { required: true, content: json(z.toJSONSchema(stockUploadBodySchema)) }, responses: { "200": okResp("Итоги загрузки", { type: "object", properties: { added: { type: "integer" }, duplicatesInBatch: { type: "integer" }, duplicatesExisting: { type: "integer" }, rejected: { type: "integer" } } }), "422": errResp("Ошибка"), ...std } },
      },
      "/seller/stats": { get: { tags: ["Продавец"], summary: "Статистика продаж", security: secured("seller:stats"), parameters: [q("days", "Период в днях, 1–365", { type: "integer" })], responses: { "200": okResp("OK", { type: "object", additionalProperties: true }), ...std } } },
      "/admin/metrics": { get: { tags: ["Администратор"], summary: "Метрики панели администратора", security: secured("admin:metrics"), parameters: [q("days", "7, 30 или 90", { type: "integer" }), q("summary", "1 — добавить текстовую AI-сводку")], responses: { "200": okResp("OK", { type: "object", additionalProperties: true }), ...std } } },
      "/admin/products/{id}/moderate": { post: { tags: ["Администратор"], summary: "Решение по модерации товара", security: secured("admin:moderate"), parameters: [pathId()], requestBody: { required: true, content: json(z.toJSONSchema(moderateBodySchema)) }, responses: { "200": okResp("OK", { type: "object", properties: { status: { type: "string" } } }), "409": errResp("Некорректное состояние"), "422": errResp("Ошибка"), ...std } } },
    },
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer", description: "API-ключ вида ak_live_… (создаётся в кабинете: «API-ключи»)" },
        ApiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas: {
        Error: { type: "object", required: ["ok", "error"], properties: { ok: { const: false }, error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } },
        Me: { type: "object", properties: { userId: { type: "string" }, name: { type: ["string", "null"] }, role: { enum: ["USER", "SELLER", "ADMIN"] }, scopes: { type: "array", items: { enum: [...API_SCOPES] } }, keyPrefix: { type: "string" } } },
        Category: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, description: { type: ["string", "null"] }, children: { type: "array", items: { $ref: "#/components/schemas/Category" } } } },
        ProductCard: {
          type: "object",
          properties: { id: { type: "string" }, slug: { type: "string" }, title: { type: "string" }, price: { type: "integer", description: "копейки; «от», если hasVariants" }, oldPrice: { type: ["integer", "null"] }, currency: { const: "RUB" }, platform: { type: ["string", "null"] }, region: { type: ["string", "null"] }, type: { type: "string" }, deliveryMode: { type: "string" }, rating: { type: "number" }, ratingCount: { type: "integer" }, hasVariants: { type: "boolean" }, inStock: { type: "boolean" }, image: { type: ["string", "null"] }, url: { type: "string" } },
        },
        ProductPage: { type: "object", properties: { items: { type: "array", items: ref("ProductCard") }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" }, pageCount: { type: "integer" } } },
        ProductDetail: {
          allOf: [
            ref("ProductCard"),
            { type: "object", properties: { description: { type: "string" }, activation: { type: "array", items: { type: "string" } }, requiresInput: { enum: ["steamLogin", "buyerInput", null], description: "какое поле нужно передать в items[] при заказе" }, variants: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, price: { type: "integer" }, oldPrice: { type: ["integer", "null"] }, inStock: { type: "boolean" } } } } } },
          ],
        },
        OrderItem: { type: "object", properties: { id: { type: "string" }, productId: { type: "string" }, title: { type: "string" }, variantTitle: { type: ["string", "null"] }, quantity: { type: "integer" }, unitPrice: { type: "integer" }, total: { type: "integer" }, status: { type: "string" } } },
        Order: { type: "object", properties: { id: { type: "string" }, number: { type: "string" }, status: { type: "string" }, statusLabel: { type: "string" }, subtotal: { type: "integer" }, discount: { type: "integer" }, total: { type: "integer" }, currency: { const: "RUB" }, createdAt: { type: "string", format: "date-time" }, paidAt: { type: ["string", "null"] }, deliveredAt: { type: ["string", "null"] }, items: { type: "array", items: ref("OrderItem") } } },
        OrderWithDelivery: { allOf: [ref("Order"), { type: "object", properties: { items: { type: "array", items: { allOf: [ref("OrderItem"), { type: "object", properties: { delivery: { type: "object", properties: { secrets: { type: "array", items: { type: "string" }, description: "ключи/данные доступа — конфиденциально" }, data: { type: ["object", "null"] } } } } }] } } } }] },
        ProductInput: {
          type: "object",
          required: ["title", "categoryId", "type", "deliveryMode", "description", "price"],
          properties: {
            title: { type: "string", minLength: 3, maxLength: 160 }, categoryId: { type: "string" }, type: { type: "string" }, deliveryMode: { enum: ["AUTO_STOCK", "MANUAL"] }, platform: { type: ["string", "null"] }, region: { type: ["string", "null"] },
            shortDescription: { type: ["string", "null"], maxLength: 240 }, description: { type: "string", minLength: 30 }, instructions: { type: "string", description: "шаги активации, по одному в строке" },
            images: { type: "array", items: { type: "string", format: "uri" }, maxItems: 10 }, tags: { type: "array", items: { type: "string" } },
            price: { type: "integer", minimum: 100, description: "копейки" }, oldPrice: { type: ["integer", "null"] },
            variants: { type: "array", items: { type: "object", required: ["title", "price"], properties: { title: { type: "string" }, price: { type: "integer" }, oldPrice: { type: ["integer", "null"] }, isActive: { type: "boolean" } } } },
            intent: { enum: ["draft", "submit"], default: "draft" },
          },
        },
      },
    },
  };
}
