"use server";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/server/auth/session";
import { closeDisputeByBuyer, escalateDispute, postDisputeMessage, type ChatMessage } from "./disputes";
import { guarded, type ActionResult } from "./result";

/**
 * Shared dispute-chat server actions (buyer /account/disputes/[id], seller /seller/disputes/[id], and ADMIN — zone D may reuse
 * <DisputeChat/> + these actions). Access is checked per dispute inside the service: buyer, the dispute's seller, or ADMIN.
 */
export async function sendDisputeMessageAction(input: { disputeId: string; body: string }): Promise<ActionResult<{ message: ChatMessage }>> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    return postDisputeMessage(user, input);
  });
}

export async function escalateDisputeAction(disputeId: string): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER");
    const res = await escalateDispute(user, disputeId);
    if (res.ok) {
      revalidatePath("/account/disputes");
      revalidatePath("/seller/disputes");
    }
    return res;
  });
}

export async function closeDisputeAction(disputeId: string): Promise<ActionResult> {
  return guarded(async () => {
    const user = await assertRole("USER", "SELLER");
    const res = await closeDisputeByBuyer(user, disputeId);
    if (res.ok) {
      revalidatePath("/account/disputes");
      revalidatePath("/account/orders");
    }
    return res;
  });
}
