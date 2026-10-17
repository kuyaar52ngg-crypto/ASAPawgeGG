"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as promos from "@/server/admin/promocodes";

export async function savePromoAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await promos.savePromo(ctx, input);
    if (r.ok) revalidatePath("/admin/promocodes");
    return r;
  });
}
export async function togglePromoAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await promos.togglePromo(ctx, input);
    if (r.ok) revalidatePath("/admin/promocodes");
    return r;
  });
}
export async function deletePromoAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await promos.deletePromo(ctx, input);
    if (r.ok) revalidatePath("/admin/promocodes");
    return r;
  });
}
