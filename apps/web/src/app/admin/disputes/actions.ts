"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as disputes from "@/server/admin/disputes";

function done(input: unknown) {
  revalidatePath("/admin/disputes");
  const id = (input as { disputeId?: string } | null)?.disputeId;
  if (id) revalidatePath(`/admin/disputes/${id}`);
}

export async function postDisputeMessageAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await disputes.postDisputeMessage(ctx, input);
    if (r.ok) done(input);
    return r;
  });
}

export async function resolveDisputeAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await disputes.resolveDispute(ctx, input);
    if (r.ok) {
      done(input);
      revalidatePath("/admin/orders", "layout");
    }
    return r;
  });
}

export async function generateDisputeAdviceAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await disputes.generateDisputeAdvice(ctx, input);
    if (r.ok) done(input);
    return r;
  });
}
