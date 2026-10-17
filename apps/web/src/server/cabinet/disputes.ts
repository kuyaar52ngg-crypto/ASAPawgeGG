import "server-only";
import { prisma } from "@asap/db";
import { disputeInputSchema, disputeMessageSchema, idSchema } from "@asap/shared";
import { trackEvent } from "@/server/analytics/track";
import { notify } from "@/server/notifications";
import { lockRow, transitionOrder } from "@/server/orders/lifecycle";
import { rateLimit } from "@/lib/rate-limit";
import type { SessionUser } from "@/server/auth/session";
import { ACTIVE_DISPUTE_STATUSES, DISPUTE_WINDOW_DAYS } from "@/components/cabinet/constants";
import { fail, ok, zodFail, type ActionResult } from "./result";

export interface ChatMessage {
  id: string;
  authorId: string | null;
  authorRole: "USER" | "SELLER" | "ADMIN" | "AI" | "SYSTEM";
  authorName: string;
  body: string;
  createdAt: string;
}

export interface DisputeView {
  id: string;
  orderId: string;
  orderNumber: string;
  orderItemTitle: string | null;
  reason: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  buyerId: string;
  sellerId: string;
  sellerName: string;
  /** role the viewer plays in this dispute */
  viewerRole: "USER" | "SELLER" | "ADMIN";
  canPost: boolean;
}

const isActive = (status: string) => (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(status);

/** Loads a dispute only if the viewer is its buyer, its seller or an ADMIN. */
async function loadForViewer(user: Pick<SessionUser, "id" | "role">, disputeId: string) {
  const d = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      order: { select: { id: true, number: true, status: true } },
      orderItem: { select: { title: true } },
      seller: { select: { name: true, sellerProfile: { select: { shopName: true } } } },
    },
  });
  if (!d) return null;
  const viewerRole = user.role === "ADMIN" ? "ADMIN" : d.buyerId === user.id ? "USER" : d.sellerId === user.id ? "SELLER" : null;
  if (!viewerRole) return null;
  return { d, viewerRole } as const;
}

export async function getDisputeView(user: Pick<SessionUser, "id" | "role">, disputeId: string): Promise<DisputeView | null> {
  const found = await loadForViewer(user, disputeId);
  if (!found) return null;
  const { d, viewerRole } = found;
  return {
    id: d.id,
    orderId: d.order.id,
    orderNumber: d.order.number,
    orderItemTitle: d.orderItem?.title ?? null,
    reason: d.reason,
    status: d.status,
    resolution: d.resolution,
    createdAt: d.createdAt.toISOString(),
    buyerId: d.buyerId,
    sellerId: d.sellerId,
    sellerName: d.seller.sellerProfile?.shopName ?? d.seller.name ?? "Продавец",
    viewerRole,
    canPost: isActive(d.status),
  };
}

function authorName(role: string, sellerName: string): string {
  switch (role) {
    case "USER": return "Покупатель";
    case "SELLER": return sellerName;
    case "ADMIN": return "Поддержка ASAPawge";
    case "AI": return "AI-ассистент";
    default: return "Система";
  }
}

/** Messages of a dispute (optionally only those created at/after `afterIso`; the client de-duplicates by id). */
export async function listDisputeMessages(user: Pick<SessionUser, "id" | "role">, disputeId: string, afterIso?: string): Promise<{ messages: ChatMessage[]; status: string; canPost: boolean } | null> {
  const found = await loadForViewer(user, disputeId);
  if (!found) return null;
  const after = afterIso ? new Date(afterIso) : null;
  const sellerName = found.d.seller.sellerProfile?.shopName ?? found.d.seller.name ?? "Продавец";
  const rows = await prisma.disputeMessage.findMany({
    where: { disputeId, ...(after && !Number.isNaN(after.getTime()) ? { createdAt: { gte: after } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  return {
    status: found.d.status,
    canPost: isActive(found.d.status),
    messages: rows.map((m) => ({
      id: m.id,
      authorId: m.authorId,
      authorRole: m.authorRole as ChatMessage["authorRole"],
      authorName: authorName(m.authorRole, sellerName),
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

async function notifyOnce(userId: string, disputeId: string, n: { title: string; body?: string; link: string }) {
  const unread = await prisma.notification.findFirst({
    where: { userId, type: "DISPUTE_UPDATE", readAt: null, data: { path: ["disputeId"], equals: disputeId } },
    select: { id: true },
  });
  if (unread) return;
  await notify(userId, { type: "DISPUTE_UPDATE", title: n.title, body: n.body, link: n.link, data: { disputeId } }).catch(() => {});
}

async function notifyAdmins(disputeId: string, title: string, body?: string) {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", banned: false }, select: { id: true }, take: 20 });
  await Promise.all(admins.map((a) => notifyOnce(a.id, disputeId, { title, body, link: "/admin/disputes" })));
}

/** Buyer opens a dispute on a delivered order item: Dispute + first message + order DELIVERED -> DISPUTED. */
export async function openDispute(buyer: Pick<SessionUser, "id">, raw: unknown): Promise<ActionResult<{ disputeId: string }>> {
  const parsed = disputeInputSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const { orderItemId, reason } = parsed.data;
  const rl = await rateLimit({ key: `dispute-open:${buyer.id}`, limit: 5, windowSec: 3600 });
  if (!rl.ok) return fail("Слишком много обращений. Попробуйте позже.");

  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: { id: true, orderId: true, sellerId: true, title: true, status: true, deliveredAt: true, order: { select: { buyerId: true, number: true, deliveredAt: true } } },
  });
  if (!item || item.order.buyerId !== buyer.id) return fail("Позиция заказа не найдена");
  if (item.status !== "DELIVERED") return fail("Спор можно открыть только по выданному товару");
  const deliveredAt = item.deliveredAt ?? item.order.deliveredAt;
  if (deliveredAt && Date.now() - deliveredAt.getTime() > DISPUTE_WINDOW_DAYS * 86_400_000) return fail(`Срок для открытия спора (${DISPUTE_WINDOW_DAYS} дней после выдачи) истёк`);

  const result = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Order", item.orderId);
    const order = await tx.order.findUnique({ where: { id: item.orderId }, select: { id: true, status: true } });
    if (!order || order.status !== "DELIVERED") return fail("Спор можно открыть только по выданному заказу");
    const existing = await tx.dispute.findFirst({ where: { orderItemId, status: { in: [...ACTIVE_DISPUTE_STATUSES] } }, select: { id: true } });
    if (existing) return fail("По этой позиции уже есть открытый спор");
    const dispute = await tx.dispute.create({
      data: {
        orderId: item.orderId,
        orderItemId,
        buyerId: buyer.id,
        sellerId: item.sellerId,
        reason,
        status: "OPEN",
        messages: {
          create: [
            { authorId: buyer.id, authorRole: "USER", body: reason },
            { authorRole: "SYSTEM", body: "Спор открыт. Продавец получил уведомление и ответит в этом чате. Если договориться не получится, подключится администратор." },
          ],
        },
      },
      select: { id: true },
    });
    await transitionOrder(tx, order, "DISPUTED");
    return ok({ disputeId: dispute.id });
  });
  if (!result.ok) return result;

  void trackEvent({ name: "dispute_open", userId: buyer.id, properties: { orderId: item.orderId } });
  await notifyOnce(item.sellerId, result.data.disputeId, { title: `Спор по заказу ${item.order.number}`, body: `«${item.title}»: ${reason.slice(0, 140)}`, link: `/seller/disputes/${result.data.disputeId}` });
  await notifyAdmins(result.data.disputeId, `Новый спор по заказу ${item.order.number}`, reason.slice(0, 140));
  return result;
}

/** Post a chat message (buyer, seller of the dispute, or ADMIN). */
export async function postDisputeMessage(user: Pick<SessionUser, "id" | "role">, raw: unknown): Promise<ActionResult<{ message: ChatMessage }>> {
  const parsed = disputeMessageSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const rl = await rateLimit({ key: `dispute-msg:${user.id}`, limit: 30, windowSec: 60 });
  if (!rl.ok) return fail("Слишком часто. Подождите немного.");

  const found = await loadForViewer(user, parsed.data.disputeId);
  if (!found) return fail("Спор не найден");
  const { d, viewerRole } = found;
  if (!isActive(d.status)) return fail("Спор закрыт — писать в него больше нельзя");

  const sellerName = d.seller.sellerProfile?.shopName ?? d.seller.name ?? "Продавец";
  const row = await prisma.$transaction(async (tx) => {
    const m = await tx.disputeMessage.create({ data: { disputeId: d.id, authorId: user.id, authorRole: viewerRole, body: parsed.data.body } });
    // seller answer -> SELLER_REPLIED; buyer follow-up -> back to OPEN (needs the seller's attention); ESCALATED stays
    if (viewerRole === "SELLER" && d.status === "OPEN") await tx.dispute.update({ where: { id: d.id }, data: { status: "SELLER_REPLIED" } });
    else if (viewerRole === "USER" && d.status === "SELLER_REPLIED") await tx.dispute.update({ where: { id: d.id }, data: { status: "OPEN" } });
    else await tx.dispute.update({ where: { id: d.id }, data: { updatedAt: new Date() } });
    return m;
  });

  const snippet = parsed.data.body.slice(0, 140);
  if (viewerRole !== "USER") await notifyOnce(d.buyerId, d.id, { title: `Новое сообщение по заказу ${d.order.number}`, body: snippet, link: `/account/disputes/${d.id}` });
  if (viewerRole !== "SELLER") await notifyOnce(d.sellerId, d.id, { title: `Новое сообщение по заказу ${d.order.number}`, body: snippet, link: `/seller/disputes/${d.id}` });
  if (viewerRole !== "ADMIN" && d.status === "ESCALATED") await notifyAdmins(d.id, `Новое сообщение в споре ${d.order.number}`, snippet);

  return ok({
    message: { id: row.id, authorId: row.authorId, authorRole: viewerRole, authorName: authorName(viewerRole, sellerName), body: row.body, createdAt: row.createdAt.toISOString() },
  });
}

/** Buyer or seller asks the administrator to step in. */
export async function escalateDispute(user: Pick<SessionUser, "id" | "role">, rawId: unknown): Promise<ActionResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return fail("Спор не найден");
  const found = await loadForViewer(user, id.data);
  if (!found || found.viewerRole === "ADMIN") return fail("Спор не найден");
  const { d, viewerRole } = found;
  if (d.status === "ESCALATED") return fail("Администратор уже подключён к спору");
  if (!isActive(d.status)) return fail("Спор уже закрыт");
  await prisma.$transaction([
    prisma.dispute.update({ where: { id: d.id }, data: { status: "ESCALATED" } }),
    prisma.disputeMessage.create({ data: { disputeId: d.id, authorRole: "SYSTEM", body: `${viewerRole === "USER" ? "Покупатель" : "Продавец"} запросил участие администратора. Мы изучим переписку и вернёмся с решением.` } }),
  ]);
  await notifyAdmins(d.id, `Спор по заказу ${d.order.number} передан администратору`, d.reason.slice(0, 140));
  const other = viewerRole === "USER" ? d.sellerId : d.buyerId;
  await notifyOnce(other, d.id, { title: `Спор по заказу ${d.order.number}: подключён администратор`, link: viewerRole === "USER" ? `/seller/disputes/${d.id}` : `/account/disputes/${d.id}` });
  return ok();
}

/** Buyer closes the dispute himself ("вопрос решён"). Order goes back DISPUTED -> DELIVERED when no other dispute is active. */
export async function closeDisputeByBuyer(user: Pick<SessionUser, "id">, rawId: unknown): Promise<ActionResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return fail("Спор не найден");
  const res = await prisma.$transaction(async (tx) => {
    const d = await tx.dispute.findUnique({ where: { id: id.data }, select: { id: true, orderId: true, buyerId: true, sellerId: true, status: true, order: { select: { number: true } } } });
    if (!d || d.buyerId !== user.id) return fail("Спор не найден");
    if (!isActive(d.status)) return fail("Спор уже закрыт");
    await lockRow(tx, "Order", d.orderId);
    await tx.dispute.update({ where: { id: d.id }, data: { status: "CLOSED", resolvedAt: new Date(), resolution: "Закрыт покупателем: вопрос решён" } });
    await tx.disputeMessage.create({ data: { disputeId: d.id, authorRole: "SYSTEM", body: "Покупатель закрыл спор: вопрос решён." } });
    const stillActive = await tx.dispute.count({ where: { orderId: d.orderId, status: { in: [...ACTIVE_DISPUTE_STATUSES] } } });
    const order = await tx.order.findUnique({ where: { id: d.orderId }, select: { id: true, status: true } });
    if (order && order.status === "DISPUTED" && stillActive === 0) await transitionOrder(tx, order, "DELIVERED");
    return ok({ sellerId: d.sellerId, number: d.order.number, id: d.id });
  });
  if (!res.ok) return res;
  await notifyOnce(res.data.sellerId, res.data.id, { title: `Спор по заказу ${res.data.number} закрыт покупателем`, link: `/seller/disputes/${res.data.id}` });
  return ok();
}
