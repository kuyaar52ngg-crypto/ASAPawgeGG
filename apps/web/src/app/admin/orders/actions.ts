"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as orders from "@/server/admin/orders";

function done(input: unknown) {
  revalidatePath("/admin/orders");
  const id = (input as { orderId?: string } | null)?.orderId;
  if (id) revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/disputes");
}

export async function manualDeliverAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await orders.manualDeliver(ctx, input);
    if (r.ok) revalidatePath("/admin/orders", "layout");
    return r;
  });
}

export async function retryFulfillmentAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await orders.retryFulfillment(ctx, input);
    if (r.ok) done(input);
    return r;
  });
}

export async function refundOrderAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await orders.refundOrderAdmin(ctx, input);
    if (r.ok) done(input);
    return r;
  });
}

export async function cancelOrderAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await orders.cancelPendingOrder(ctx, input);
    if (r.ok) done(input);
    return r;
  });
}
