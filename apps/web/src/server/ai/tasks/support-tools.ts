import "server-only";
import { z } from "zod";
import { getSetting, prisma } from "@asap/db";
import { ORDER_STATUS_LABELS, SETTING_KEYS, type OrderStatusName } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import { openDispute } from "@/server/cabinet/disputes";
import { listProducts } from "@/server/catalog/queries";
import { catalogPageQuerySchema } from "@/server/catalog/query";
import { searchProductIds } from "@/server/catalog/search";
import { notify } from "@/server/notifications";
import { searchFaq } from "../faq";
import type { ToolDef } from "../types";

/** Who is chatting. Tools that touch personal data receive the VERIFIED session user — never an id from the model. */
export interface SupportCtx {
  userId: string | null;
}

export const SUPPORT_TOOLS: ToolDef[] = [
  {
    name: "search_products",
    description: "Поиск товаров в каталоге ASAPawge GG по названию или описанию (игры, подписки, пополнение Steam, подарочные карты). Возвращает до 6 товаров с ценой в копейках и ссылкой.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос, например «spotify», «gta 5», «xbox game pass»" },
        maxPriceRub: { type: "number", description: "Максимальная цена в рублях (необязательно)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_order_status",
    description: "Статус заказов ТЕКУЩЕГО пользователя. Без номера — последние 3 заказа; с номером (формат AG-250101-AB12) — конкретный заказ. Чужие заказы недоступны. Ключи и данные выдачи не возвращаются.",
    parameters: { type: "object", properties: { orderNumber: { type: "string", description: "Номер заказа, например AG-250101-AB12" } } },
  },
  {
    name: "get_faq",
    description: "Поиск ответа в базе знаний (оплата, выдача, возвраты, споры, продавцам, API). Используй для вопросов о правилах площадки.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Вопрос пользователя" } }, required: ["query"] },
  },
  {
    name: "create_support_ticket",
    description: "Передать обращение живому администратору, если проблему не удалось решить. Если указан номер заказа — по возможности открывается спор. Вызывай только когда пользователь просит человека или проблема не решается.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Краткая тема обращения" },
        message: { type: "string", description: "Суть проблемы своими словами пользователя" },
        orderNumber: { type: "string", description: "Номер заказа, если обращение связано с ним" },
      },
      required: ["subject", "message"],
    },
  },
];

/** Tools offered to the model: guests get only the public ones. */
export function toolsFor(ctx: SupportCtx): ToolDef[] {
  return ctx.userId ? SUPPORT_TOOLS : SUPPORT_TOOLS.filter((t) => t.name === "search_products" || t.name === "get_faq");
}

const searchArgs = z.object({ query: z.string().trim().min(1).max(120), maxPriceRub: z.coerce.number().positive().max(1_000_000).optional() });
const orderArgs = z.object({ orderNumber: z.string().trim().regex(/^AG-\d{6}-[A-Za-z0-9]{4}$/, "Некорректный номер заказа").optional() });
const faqArgs = z.object({ query: z.string().trim().min(1).max(300) });
const ticketArgs = z.object({ subject: z.string().trim().min(3).max(120), message: z.string().trim().min(5).max(2000), orderNumber: z.string().trim().max(32).optional() });

async function searchProducts(args: unknown) {
  const a = searchArgs.parse(args);
  const ids = await searchProductIds(a.query, 30);
  if (ids.length === 0) return { products: [] };
  const q = catalogPageQuerySchema.parse({ sort: "relevance", pageSize: 6, ...(a.maxPriceRub ? { maxPrice: Math.round(a.maxPriceRub * 100) } : {}) });
  const res = await listProducts(q, { ids });
  return {
    products: res.items.map((p) => ({ title: p.title, price: p.price, oldPrice: p.oldPrice, platform: p.platform, region: p.region, inStock: p.inStock, hasVariants: p.hasVariants, url: `/product/${p.slug}` })),
    note: "price в копейках — «от» цены, если hasVariants",
  };
}

async function orderStatus(ctx: SupportCtx, args: unknown) {
  if (!ctx.userId) return { error: "Чтобы узнать статус заказа, войдите в аккаунт." };
  const a = orderArgs.parse(args);
  const orders = await prisma.order.findMany({
    where: { buyerId: ctx.userId, ...(a.orderNumber ? { number: a.orderNumber.toUpperCase() } : {}) },
    orderBy: { createdAt: "desc" },
    take: a.orderNumber ? 1 : 3,
    select: { id: true, number: true, status: true, total: true, createdAt: true, paidAt: true, deliveredAt: true, items: { select: { title: true, quantity: true, status: true } } },
  });
  if (a.orderNumber && orders.length === 0) return { error: `Заказ ${a.orderNumber.toUpperCase()} не найден на вашем аккаунте.` };
  return {
    orders: orders.map((o) => ({
      number: o.number,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status as OrderStatusName] ?? o.status,
      total: o.total,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      items: o.items.map((i) => `${i.title} ×${i.quantity} (${i.status})`),
      link: `/account/orders/${o.id}`,
    })),
  };
}

async function faq(args: unknown) {
  const a = faqArgs.parse(args);
  const items = searchFaq(a.query);
  const contacts = await getSetting<unknown>(SETTING_KEYS.supportContacts, null).catch(() => null);
  return { items, ...(items.length === 0 && contacts ? { contacts } : {}) };
}

async function createTicket(ctx: SupportCtx, args: unknown) {
  if (!ctx.userId) return { error: "Чтобы обратиться к администратору, войдите в аккаунт." };
  const a = ticketArgs.parse(args);
  const rl = await rateLimit({ key: `ai-ticket:${ctx.userId}`, limit: 5, windowSec: 3600 });
  if (!rl.ok) return { error: "Слишком много обращений за час. Попробуйте позже." };

  // 1) a real dispute when the order exists, is the user's own and is eligible (delivered, inside the 14-day window)
  if (a.orderNumber) {
    const order = await prisma.order.findFirst({
      where: { number: a.orderNumber.toUpperCase(), buyerId: ctx.userId },
      select: { id: true, items: { where: { status: "DELIVERED" }, take: 1, select: { id: true } } },
    });
    const item = order?.items[0];
    if (order && item) {
      const res = await openDispute({ id: ctx.userId }, { orderItemId: item.id, reason: `${a.subject}: ${a.message}`.slice(0, 2000) });
      if (res.ok) return { ticketId: res.data.disputeId, kind: "dispute", link: `/account/disputes/${res.data.disputeId}` };
    }
  }
  // 2) otherwise a notification for every active admin (the "message for admins")
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", banned: false }, select: { id: true }, take: 20 });
  if (admins.length === 0) return { error: "Сейчас нет доступных администраторов. Напишите на контакты из раздела «Контакты»." };
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true, name: true } });
  const ticketId = `T${Date.now().toString(36).toUpperCase()}`;
  const body = `${user?.name ?? user?.email ?? ctx.userId} (${user?.email ?? "—"})${a.orderNumber ? `, заказ ${a.orderNumber}` : ""}: ${a.message}`.slice(0, 1000);
  await Promise.all(admins.map((x) => notify(x.id, { type: "SYSTEM", title: `Обращение из чата: ${a.subject}`, body, link: "/admin/disputes", data: { source: "support_chat", ticketId, userId: ctx.userId } })));
  return { ticketId, kind: "notification" };
}

/** Executes one model-requested tool. Never throws: errors become a JSON `{ error }` the model can relay. */
export async function runSupportTool(ctx: SupportCtx, name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (!toolsFor(ctx).some((t) => t.name === name)) return JSON.stringify({ error: "Инструмент недоступен" });
    switch (name) {
      case "search_products":
        return JSON.stringify(await searchProducts(args));
      case "get_order_status":
        return JSON.stringify(await orderStatus(ctx, args));
      case "get_faq":
        return JSON.stringify(await faq(args));
      case "create_support_ticket":
        return JSON.stringify(await createTicket(ctx, args));
      default:
        return JSON.stringify({ error: "Неизвестный инструмент" });
    }
  } catch (e) {
    if (e instanceof z.ZodError) return JSON.stringify({ error: e.issues[0]?.message ?? "Некорректные аргументы" });
    console.error(`[ai] tool ${name} failed:`, e);
    return JSON.stringify({ error: "Не удалось выполнить действие. Попробуйте позже." });
  }
}
