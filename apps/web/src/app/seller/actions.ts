"use server";
import { revalidatePath } from "next/cache";
import { assertSeller } from "@/server/cabinet/seller-context";
import { describeProduct, type DescribeResult } from "@/server/cabinet/describe";
import { cancelPayout, requestPayout } from "@/server/cabinet/payouts";
import { archiveProduct, deleteProduct, restoreProduct, saveProduct, type SaveProductOutcome } from "@/server/cabinet/products";
import { guarded, type ActionResult } from "@/server/cabinet/result";
import { deliverManualItem } from "@/server/cabinet/seller-orders";
import { replyToReview, updateShop } from "@/server/cabinet/seller-misc";
import { deleteUnsoldStock, uploadStock, type StockUploadSummary } from "@/server/cabinet/stock";

// Every action: zod-validated inside the service, role + profile checked here (assertSeller), ownership checked in the service.

// ───────────── products ─────────────

export async function saveProductAction(productId: string | null, input: unknown): Promise<ActionResult<SaveProductOutcome>> {
  return guarded(async () => {
    const ctx = await assertSeller({ write: true });
    const res = await saveProduct(ctx, productId, input);
    if (res.ok) {
      revalidatePath("/seller/products");
      revalidatePath("/seller");
    }
    return res;
  });
}

export async function archiveProductAction(productId: string): Promise<ActionResult> {
  return guarded(async () => {
    const res = await archiveProduct(await assertSeller({ write: true }), productId);
    if (res.ok) revalidatePath("/seller/products");
    return res;
  });
}

export async function restoreProductAction(productId: string): Promise<ActionResult> {
  return guarded(async () => {
    const res = await restoreProduct(await assertSeller({ write: true }), productId);
    if (res.ok) revalidatePath("/seller/products");
    return res;
  });
}

export async function deleteProductAction(productId: string): Promise<ActionResult> {
  return guarded(async () => {
    const res = await deleteProduct(await assertSeller({ write: true }), productId);
    if (res.ok) revalidatePath("/seller/products");
    return res;
  });
}

/** «AI: сгенерировать описание» */
export async function describeProductAction(input: unknown): Promise<ActionResult<DescribeResult>> {
  return guarded(async () => {
    const ctx = await assertSeller({ write: true });
    return describeProduct(ctx.user, input);
  });
}

// ───────────── stock ─────────────

export async function uploadStockAction(input: { productId: string; variantId?: string | null; items: string[] }): Promise<ActionResult<StockUploadSummary>> {
  return guarded(async () => {
    const res = await uploadStock(await assertSeller({ write: true }), input);
    if (res.ok) {
      revalidatePath(`/seller/products/${input.productId}/stock`);
      revalidatePath("/seller/stock");
    }
    return res;
  });
}

export async function deleteStockAction(input: { productId: string; ids: string[] } | { productId: string; all: true; variantId?: string | null }): Promise<ActionResult<{ deleted: number }>> {
  return guarded(async () => {
    const res = await deleteUnsoldStock(await assertSeller({ write: true }), input);
    if (res.ok) {
      revalidatePath(`/seller/products/${input.productId}/stock`);
      revalidatePath("/seller/stock");
    }
    return res;
  });
}

// ───────────── orders ─────────────

export async function deliverManualAction(input: { orderItemId: string; message: string }): Promise<ActionResult<{ orderStatus: string }>> {
  return guarded(async () => {
    const res = await deliverManualItem(await assertSeller({ write: true }), input);
    if (res.ok) {
      revalidatePath("/seller/orders");
      revalidatePath("/seller");
    }
    return res;
  });
}

// ───────────── reviews ─────────────

export async function replyReviewAction(input: { reviewId: string; reply: string }): Promise<ActionResult> {
  return guarded(async () => {
    const res = await replyToReview(await assertSeller({ write: true }), input);
    if (res.ok) revalidatePath("/seller/reviews");
    return res;
  });
}

// ───────────── payouts ─────────────

export async function requestPayoutAction(input: { amount: number; method: "CARD" | "SBP" | "USDT" | "YOOMONEY"; details: Record<string, string> }): Promise<ActionResult<{ payoutId: string }>> {
  return guarded(async () => {
    const res = await requestPayout(await assertSeller({ verified: true }), input);
    if (res.ok) {
      revalidatePath("/seller/payouts");
      revalidatePath("/seller");
    }
    return res;
  });
}

export async function cancelPayoutAction(payoutId: string): Promise<ActionResult> {
  return guarded(async () => {
    const res = await cancelPayout(await assertSeller({ write: true }), payoutId);
    if (res.ok) {
      revalidatePath("/seller/payouts");
      revalidatePath("/seller");
    }
    return res;
  });
}

// ───────────── settings ─────────────

export async function updateShopAction(input: { shopName: string; description?: string; avatar?: string }): Promise<ActionResult> {
  return guarded(async () => {
    const res = await updateShop(await assertSeller({ write: true }), input);
    if (res.ok) {
      revalidatePath("/seller/settings");
      revalidatePath("/seller", "layout");
    }
    return res;
  });
}
