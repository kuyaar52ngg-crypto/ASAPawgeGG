"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as products from "@/server/admin/products";

function revalidate(productId?: string) {
  revalidatePath("/admin/products");
  if (productId) revalidatePath(`/admin/products/${productId}`);
}

export async function moderateProductAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await products.moderateProduct(ctx, input);
    if (r.ok) {
      revalidate((input as { productId?: string })?.productId);
      revalidatePath("/catalog");
    }
    return r;
  });
}

export async function updateProductAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await products.updateProduct(ctx, input);
    if (r.ok) revalidate((input as { productId?: string })?.productId);
    return r;
  });
}

export async function rerunAiModerationAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await products.rerunAiModeration(ctx, input);
    if (r.ok) revalidate((input as { productId?: string })?.productId);
    return r;
  });
}
