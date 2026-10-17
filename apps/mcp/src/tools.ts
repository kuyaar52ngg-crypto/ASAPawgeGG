import { z } from "zod";
import { ApiError, type AsapApiClient, type Me } from "./api-client";

/**
 * MCP tool catalogue. Each tool = one REST call. A tool is exposed to a client only when the API key holds the
 * tool's scope (`/me` → scopes already intersected with the key owner's current role), so e.g. a buyer key never even
 * sees seller/admin tools. The REST API still enforces everything server-side.
 */

export const rub = (kopecks: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(kopecks / 100)} ₽`;
export const toKopecks = (rubles: number) => Math.round(rubles * 100);

/** Adds human-readable ₽ amounts next to kopecks so the model never has to divide by 100. */
export function humanizeMoney<T>(value: T): T {
  if (Array.isArray(value)) return value.map(humanizeMoney) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = humanizeMoney(v);
      if (typeof v === "number" && Number.isInteger(v) && /^(price|oldPrice|unitPrice|total|subtotal|discount|balance)$/.test(k)) out[`${k}Rub`] = rub(v);
    }
    return out as T;
  }
  return value;
}

const productType = z.enum(["KEY", "ACCOUNT", "SUBSCRIPTION", "TOPUP", "GIFT_CARD", "CURRENCY", "SERVICE"]);
const id = z.string().min(1).max(64);

export const orderItemInput = z.object({
  productId: id.describe("id товара (из search_products / get_product)"),
  variantId: id.optional().describe("id варианта — обязателен, если у товара есть варианты (срок, номинал)"),
  quantity: z.number().int().min(1).max(50).default(1),
  steamLogin: z.string().min(3).max(64).optional().describe("Логин Steam — только для пополнения Steam (requiresInput = steamLogin)"),
  amountRub: z.number().min(10).max(100000).optional().describe("Сумма пополнения кошелька Steam в рублях, если не выбран готовый вариант"),
  buyerInput: z.string().min(2).max(200).optional().describe("Данные для выдачи (UID/логин/email) — для товаров с ручной выдачей (requiresInput = buyerInput)"),
});

export const createOrderInput = z.object({
  items: z.array(orderItemInput).min(1).max(20),
  promoCode: z.string().max(40).optional(),
  confirmPurchase: z.literal(true).describe("Поставьте true ТОЛЬКО после того, как пользователь явно подтвердил покупку и итоговую сумму"),
  idempotencyKey: z.string().min(8).max(120).optional().describe("Ключ идемпотентности: повтор с тем же ключом вернёт тот же заказ, а не создаст новый"),
});

export const sellerProductInput = z.object({
  title: z.string().min(3).max(160),
  categoryId: id.describe("id категории из list_categories"),
  type: productType,
  deliveryMode: z.enum(["AUTO_STOCK", "MANUAL"]).describe("AUTO_STOCK — мгновенная выдача из склада ключей, MANUAL — продавец выдаёт вручную"),
  description: z.string().min(30).max(10000),
  priceRub: z.number().min(1).max(1_000_000).describe("Цена в рублях (если есть variants — базовая, считается по минимальному варианту)"),
  oldPriceRub: z.number().min(1).max(1_000_000).optional(),
  platform: z.string().max(40).optional().describe("STEAM, XBOX, PLAYSTATION, ..."),
  region: z.string().max(40).optional(),
  shortDescription: z.string().max(240).optional(),
  instructions: z.string().max(4000).optional().describe("Шаги активации, по одному на строку"),
  images: z.array(z.string().url()).max(10).optional().describe("https-ссылки на изображения с разрешённых хостов"),
  tags: z.array(z.string().max(40)).max(15).optional(),
  variants: z.array(z.object({ title: z.string().min(1).max(120), priceRub: z.number().min(1).max(1_000_000), oldPriceRub: z.number().min(1).optional() })).max(30).optional(),
  submitForModeration: z.boolean().default(false).describe("false — сохранить черновик, true — отправить на модерацию (нужен подтверждённый профиль)"),
});

interface ToolCtx {
  api: AsapApiClient;
  me: Me;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** REST scope required to expose and call the tool */
  scope: string;
  input: z.ZodRawShape;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
  run: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<unknown>;
}

const RO = { readOnlyHint: true, openWorldHint: false } as const;

export const TOOLS: ToolDef[] = [
  {
    name: "search_products",
    title: "Поиск товаров",
    description: "Ищет товары в каталоге ASAPawge GG (игры, подписки, пополнение Steam, подарочные карты). Возвращает цены (price — копейки, priceRub — строка) и наличие. Для деталей и вариантов вызовите get_product.",
    scope: "catalog:read",
    input: {
      query: z.string().max(100).optional().describe("Поисковая фраза: «spotify», «gta 5», «xbox game pass»"),
      category: z.string().max(120).optional().describe("slug категории из list_categories"),
      platform: z.string().max(40).optional(),
      region: z.string().max(40).optional(),
      type: productType.optional(),
      minPriceRub: z.number().min(0).optional(),
      maxPriceRub: z.number().min(0).optional(),
      inStock: z.boolean().optional().describe("true — только то, что есть в наличии"),
      sort: z.enum(["popular", "new", "price_asc", "price_desc", "rating", "discount", "relevance"]).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(30).default(10),
    },
    annotations: RO,
    run: async ({ api }, a) =>
      humanizeMoney(
        await api.searchProducts({
          q: a.query as string | undefined,
          category: a.category as string | undefined,
          platform: a.platform as string | undefined,
          region: a.region as string | undefined,
          type: a.type as string | undefined,
          minPrice: typeof a.minPriceRub === "number" ? toKopecks(a.minPriceRub) : undefined,
          maxPrice: typeof a.maxPriceRub === "number" ? toKopecks(a.maxPriceRub) : undefined,
          inStock: a.inStock ? 1 : undefined,
          sort: a.sort as string | undefined,
          page: a.page as number | undefined,
          pageSize: (a.pageSize as number | undefined) ?? 10,
        }),
      ),
  },
  {
    name: "get_product",
    title: "Карточка товара",
    description: "Полная карточка товара по id или slug: описание, варианты с ценами и наличием, какие данные нужны для заказа (requiresInput).",
    scope: "catalog:read",
    input: { productId: z.string().min(1).max(160).describe("id или slug товара") },
    annotations: RO,
    run: async ({ api }, a) => humanizeMoney(await api.getProduct(a.productId as string)),
  },
  {
    name: "list_categories",
    title: "Категории",
    description: "Дерево категорий каталога (id, slug, название).",
    scope: "catalog:read",
    input: {},
    annotations: RO,
    run: async ({ api }) => api.categories(),
  },
  {
    name: "create_order",
    title: "Купить товары с баланса",
    description:
      "Создаёт заказ и ОПЛАЧИВАЕТ его с баланса сайта (списание необратимо без возврата через поддержку). Перед вызовом покажите пользователю товары и итоговую сумму и получите явное подтверждение, затем передайте confirmPurchase=true. При нехватке средств вернётся ошибка insufficient_funds. Выданные ключи приходят в ответе (items[].delivery.secrets), если выдача завершилась сразу; иначе проверяйте get_order_status.",
    scope: "orders:create",
    input: createOrderInput.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: async ({ api }, a) => {
      const input = createOrderInput.parse(a);
      const body = {
        items: input.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, steamLogin: i.steamLogin, buyerInput: i.buyerInput, amountKopecks: i.amountRub !== undefined ? toKopecks(i.amountRub) : undefined })),
        promoCode: input.promoCode,
      };
      return humanizeMoney(await api.createOrder(body, input.idempotencyKey ?? crypto.randomUUID()));
    },
  },
  {
    name: "get_order_status",
    title: "Статус заказа",
    description: "Статус заказа по id или номеру (AG-…) и выданное содержимое (ключи) после выдачи. Только свои заказы.",
    scope: "orders:read",
    input: { orderId: z.string().min(1).max(64).describe("id заказа или номер вида AG-251017-AB12") },
    annotations: RO,
    run: async ({ api }, a) => humanizeMoney(await api.getOrder(a.orderId as string)),
  },
  {
    name: "list_my_orders",
    title: "Мои заказы",
    description: "Список своих заказов (без ключей). Для ключей вызовите get_order_status.",
    scope: "orders:read",
    input: {
      status: z.enum(["PENDING", "PAID", "PROCESSING", "DELIVERED", "DISPUTED", "REFUNDED", "CANCELLED", "FAILED"]).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(50).default(10),
    },
    annotations: RO,
    run: async ({ api }, a) => humanizeMoney(await api.listOrders({ status: a.status as string | undefined, page: a.page as number | undefined, pageSize: (a.pageSize as number | undefined) ?? 10 })),
  },
  {
    name: "get_balance",
    title: "Баланс",
    description: "Баланс аккаунта на сайте (из него оплачиваются заказы через create_order).",
    scope: "orders:read",
    input: {},
    annotations: RO,
    run: async ({ api }) => humanizeMoney(await api.balance()),
  },
  {
    name: "seller_create_product",
    title: "Создать товар (продавец)",
    description: "Создаёт товар продавца: черновик или отправка на модерацию. Цены в рублях. После создания загрузите ключи через seller_upload_stock (для AUTO_STOCK).",
    scope: "seller:products",
    input: sellerProductInput.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async ({ api }, a) => {
      const i = sellerProductInput.parse(a);
      return api.sellerCreateProduct({
        title: i.title,
        categoryId: i.categoryId,
        type: i.type,
        deliveryMode: i.deliveryMode,
        description: i.description,
        price: toKopecks(i.priceRub),
        oldPrice: i.oldPriceRub !== undefined ? toKopecks(i.oldPriceRub) : undefined,
        platform: i.platform,
        region: i.region,
        shortDescription: i.shortDescription,
        instructions: i.instructions ?? "",
        images: i.images ?? [],
        tags: i.tags ?? [],
        variants: (i.variants ?? []).map((v) => ({ title: v.title, price: toKopecks(v.priceRub), oldPrice: v.oldPriceRub !== undefined ? toKopecks(v.oldPriceRub) : undefined, isActive: true })),
        intent: i.submitForModeration ? "submit" : "draft",
      });
    },
  },
  {
    name: "seller_upload_stock",
    title: "Загрузить ключи (продавец)",
    description: "Загружает ключи/коды на склад своего товара с автовыдачей (до 5000 за вызов). Дубликаты пропускаются, данные шифруются. Если у товара есть варианты — укажите variantId.",
    scope: "seller:stock",
    input: { productId: id, variantId: id.optional(), items: z.array(z.string().min(1).max(4000)).min(1).max(5000).describe("по одному ключу в элементе") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ api }, a) => api.sellerUploadStock(a.productId as string, { items: a.items, variantId: (a.variantId as string | undefined) ?? null }),
  },
  {
    name: "seller_stats",
    title: "Статистика продавца",
    description: "Продажи за период, балансы (холд/доступно), товары с низким остатком, ожидающие действия.",
    scope: "seller:stats",
    input: { days: z.number().int().min(1).max(365).default(30) },
    annotations: RO,
    run: async ({ api }, a) => humanizeMoney(await api.sellerStats((a.days as number | undefined) ?? 30)),
  },
  {
    name: "admin_metrics",
    title: "Метрики площадки (админ)",
    description: "Метрики панели администратора: GMV, выручка, заказы, конверсия, воронка, топы. includeSummary=true добавляет краткую текстовую сводку.",
    scope: "admin:metrics",
    input: { days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30), includeSummary: z.boolean().default(false) },
    annotations: RO,
    run: async ({ api }, a) => api.adminMetrics((a.days as number | undefined) ?? 30, Boolean(a.includeSummary)),
  },
  {
    name: "admin_moderate_product",
    title: "Модерация товара (админ)",
    description: "Решение по товару: approve — опубликовать, reject — отклонить (нужна причина, её увидит продавец), archive — в архив. Действие записывается в аудит.",
    scope: "admin:moderate",
    input: { productId: id, decision: z.enum(["approve", "reject", "archive"]), reason: z.string().max(500).optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: async ({ api }, a) => api.adminModerate(a.productId as string, { decision: a.decision, reason: a.reason }),
  },
];

/** Tools available to a key: those whose scope the key holds. */
export function toolsFor(me: Pick<Me, "scopes">): ToolDef[] {
  return TOOLS.filter((t) => me.scopes.includes(t.scope));
}

/** Converts any failure into an MCP error result the model can read and act on (never throws). */
export function errorResult(e: unknown) {
  let text: string;
  if (e instanceof ApiError) {
    const hint = e.code === "insufficient_funds" ? " Пополните баланс на сайте: /account/topup." : e.code === "insufficient_scope" ? " Ключу не хватает прав — создайте ключ с нужными правами в кабинете." : "";
    text = `Ошибка ${e.status} (${e.code}): ${e.message}.${hint}${e.details ? ` Детали: ${JSON.stringify(e.details).slice(0, 600)}` : ""}`;
  } else if (e instanceof z.ZodError) {
    text = `Некорректные аргументы: ${e.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}`;
  } else {
    text = `Внутренняя ошибка: ${(e as Error).message}`;
  }
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}

export function okResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
