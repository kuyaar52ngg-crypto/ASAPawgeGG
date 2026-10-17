"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as sellers from "@/server/admin/sellers";

export async function reviewSellerAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await sellers.reviewSeller(ctx, input);
    if (r.ok) revalidatePath("/admin/sellers");
    return r;
  });
}

export async function setSellerCommissionAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await sellers.setSellerCommission(ctx, input);
    if (r.ok) revalidatePath("/admin/sellers");
    return r;
  });
}
