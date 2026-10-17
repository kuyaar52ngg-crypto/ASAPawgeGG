"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@asap/db";
import { idSchema } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import { assertRole } from "@/server/auth/session";
import { getOrderDelivery } from "@/server/orders/delivery";
import { applyForSeller, changePassword, updateProfile } from "@/server/cabinet/account";
import { createApiKey, revokeApiKey } from "@/server/cabinet/api-keys";
import { openDispute } from "@/server/cabinet/disputes";
import { createReview } from "@/server/cabinet/reviews";
import { fail, guarded, ok, type ActionResult } from "@/server/cabinet/result";

// ───────────── orders: reveal keys, review, dispute ─────────────

/**
 * Decrypts the delivered keys of ONE order item and returns them. Called only when the owner presses «Показать»,
 * so plaintext never travels in the page HTML. Ownership is enforced by getOrderDelivery (order.buyerId === user.id).
 */
export async function revealItemSecretsAction(orderItemId: string): Promise<ActionResult<{ secrets: string[] }>> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const id = idSchema.safeParse(orderItemId);
    if (!id.success) return fail("Позиция не найдена");
    const rl = await rateLimit({ key: `reveal:${user.id}`, limit: 60, windowSec: 60 });
    if (!rl.ok) return fail("Слишком много запросов. Подождите минуту.");
    const item = await prisma.orderItem.findUnique({ where: { id: id.data }, select: { orderId: true, order: { select: { buyerId: true } } } });
    if (!item || item.order.buyerId !== user.id) return fail("Позиция не найдена");
    const delivery = await getOrderDelivery(item.orderId, user.id);
    const line = delivery?.find((d) => d.orderItemId === id.data);
    if (!line) return fail("Позиция не найдена");
    return ok({ secrets: line.secrets });
  });
}

export async function createReviewAction(input: { orderItemId: string; rating: number; text?: string }): Promise<ActionResult<{ reviewId: string }>> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const res = await createReview(user.id, input);
    if (res.ok) {
      revalidatePath("/account/orders", "layout");
      revalidatePath("/account/reviews");
    }
    return res;
  });
}

export async function openDisputeAction(input: { orderItemId: string; reason: string }): Promise<ActionResult<{ disputeId: string }>> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const res = await openDispute(user, input);
    if (res.ok) {
      revalidatePath("/account/orders", "layout");
      revalidatePath("/account/disputes");
    }
    return res;
  });
}

// ───────────── settings ─────────────

export async function updateProfileAction(input: { name: string }): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const res = await updateProfile(user, input);
    if (res.ok) revalidatePath("/", "layout");
    return res;
  });
}

export async function changePasswordAction(input: { current: string; next: string; confirm: string }): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    return changePassword(user, input);
  });
}

// ───────────── seller application ─────────────

export async function applyForSellerAction(input: { shopName: string; description: string }): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const res = await applyForSeller(user, input);
    if (res.ok) revalidatePath("/account/become-seller");
    return res;
  });
}

// ───────────── API keys (shared by /account/api-keys and /seller/api-keys) ─────────────

export async function createApiKeyAction(input: { name: string; scopes: string[]; expiresInDays?: number }): Promise<ActionResult<{ key: string; id: string }>> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const res = await createApiKey(user, input);
    if (res.ok) {
      revalidatePath("/account/api-keys");
      revalidatePath("/seller/api-keys");
    }
    return res;
  });
}

export async function revokeApiKeyAction(keyId: string): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const res = await revokeApiKey(user, keyId);
    if (res.ok) {
      revalidatePath("/account/api-keys");
      revalidatePath("/seller/api-keys");
    }
    return res;
  });
}
