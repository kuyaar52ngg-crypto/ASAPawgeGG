import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { idSchema } from "@asap/shared";
import { notify } from "@/server/notifications";
import { imageUrlSchema } from "./images";
import type { SellerCtx } from "./seller-context";
import { fail, ok, zodFail, type ActionResult } from "./result";

const replySchema = z.object({ reviewId: idSchema, reply: z.string().trim().min(2, "Ответ слишком короткий").max(1000, "Максимум 1000 символов") });

/** Public reply to a review of the seller's own product (can be edited later). */
export async function replyToReview(ctx: SellerCtx, raw: unknown): Promise<ActionResult> {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const review = await prisma.review.findFirst({ where: { id: parsed.data.reviewId, sellerId: ctx.user.id }, select: { id: true, buyerId: true, reply: true, orderItem: { select: { title: true, orderId: true } } } });
  if (!review) return fail("Отзыв не найден");
  await prisma.review.update({ where: { id: review.id }, data: { reply: parsed.data.reply, repliedAt: new Date() } });
  if (!review.reply) {
    await notify(review.buyerId, { type: "REVIEW_NEW", title: "Продавец ответил на ваш отзыв", body: `«${review.orderItem.title}»: ${parsed.data.reply.slice(0, 120)}`, link: `/account/orders/${review.orderItem.orderId}` }).catch(() => {});
  }
  return ok();
}

const shopSchema = z.object({
  shopName: z.string().trim().min(3, "Название — минимум 3 символа").max(60, "Название — максимум 60 символов"),
  description: z.string().trim().max(1500, "Описание — максимум 1500 символов").default(""),
  avatar: z.union([z.literal(""), imageUrlSchema]).default(""),
});

export async function updateShop(ctx: SellerCtx, raw: unknown): Promise<ActionResult> {
  const parsed = shopSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  await prisma.sellerProfile.update({
    where: { userId: ctx.user.id },
    data: { shopName: parsed.data.shopName, description: parsed.data.description || null, avatar: parsed.data.avatar || null },
  });
  return ok();
}
