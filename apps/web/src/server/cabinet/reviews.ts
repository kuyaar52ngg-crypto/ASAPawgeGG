import "server-only";
import { prisma } from "@asap/db";
import { reviewInputSchema } from "@asap/shared";
import { trackEvent } from "@/server/analytics/track";
import { notify } from "@/server/notifications";
import { enqueueJob } from "@/server/worker";
import { fail, ok, zodFail, type ActionResult } from "./result";

/** Recompute cached rating aggregates of a product and its seller from PUBLISHED reviews. */
export async function recomputeRatings(productId: string, sellerId: string): Promise<void> {
  const [p, s] = await Promise.all([
    prisma.review.aggregate({ where: { productId, status: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.review.aggregate({ where: { sellerId, status: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  await prisma.product.update({ where: { id: productId }, data: { ratingAvg: round1(p._avg.rating), ratingCount: p._count._all } });
  await prisma.sellerProfile.updateMany({ where: { userId: sellerId }, data: { rating: round1(s._avg.rating), ratingCount: s._count._all } });
}
const round1 = (n: number | null) => (n ? Math.round(n * 10) / 10 : 0);

/** One review per delivered order item, only by the buyer of the order. */
export async function createReview(buyerId: string, raw: unknown): Promise<ActionResult<{ reviewId: string }>> {
  const parsed = reviewInputSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const { orderItemId, rating, text } = parsed.data;

  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: { id: true, productId: true, sellerId: true, title: true, status: true, order: { select: { id: true, number: true, buyerId: true, status: true } }, review: { select: { id: true } } },
  });
  if (!item || item.order.buyerId !== buyerId) return fail("Позиция заказа не найдена");
  if (item.status !== "DELIVERED" || !["DELIVERED", "DISPUTED"].includes(item.order.status)) return fail("Отзыв можно оставить после получения товара");
  if (item.review) return fail("Вы уже оставили отзыв на эту позицию");

  let reviewId: string;
  try {
    const review = await prisma.review.create({
      data: { orderItemId, productId: item.productId, sellerId: item.sellerId, buyerId, rating, text: text || null, status: "PUBLISHED" },
      select: { id: true },
    });
    reviewId = review.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return fail("Вы уже оставили отзыв на эту позицию");
    throw e;
  }
  await recomputeRatings(item.productId, item.sellerId);
  void enqueueJob("ai_moderate_review", { reviewId });
  void trackEvent({ name: "review_submit", userId: buyerId, properties: { productId: item.productId, orderId: item.order.id } });
  await notify(item.sellerId, { type: "REVIEW_NEW", title: `Новый отзыв (${rating}★)`, body: `«${item.title}»${text ? `: ${text.slice(0, 120)}` : ""}`, link: "/seller/reviews" }).catch(() => {});
  return ok({ reviewId });
}
