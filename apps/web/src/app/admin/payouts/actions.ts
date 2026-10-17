"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as payouts from "@/server/admin/payouts";

function done() {
  revalidatePath("/admin/payouts");
  revalidatePath("/admin");
}
export async function approvePayoutAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await payouts.approvePayout(ctx, input);
    if (r.ok) done();
    return r;
  });
}
export async function markPayoutPaidAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await payouts.markPayoutPaid(ctx, input);
    if (r.ok) done();
    return r;
  });
}
export async function rejectPayoutAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await payouts.rejectPayout(ctx, input);
    if (r.ok) done();
    return r;
  });
}
