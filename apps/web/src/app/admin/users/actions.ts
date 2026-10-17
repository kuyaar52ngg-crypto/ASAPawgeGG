"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as users from "@/server/admin/users";

export async function setUserRole(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await users.setUserRole(ctx, input);
    if (r.ok) revalidatePath("/admin/users");
    return r;
  });
}

export async function setUserBan(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await users.setUserBan(ctx, input);
    if (r.ok) revalidatePath("/admin/users");
    return r;
  });
}

export async function adjustUserBalance(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await users.adjustUserBalance(ctx, input);
    if (r.ok) revalidatePath("/admin/users");
    return r;
  });
}
