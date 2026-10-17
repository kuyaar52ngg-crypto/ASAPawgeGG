"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as settings from "@/server/admin/settings";

export async function saveSettingsAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await settings.saveSettings(ctx, input);
    if (r.ok) {
      revalidatePath("/admin/settings");
      revalidatePath("/steam");
    }
    return r;
  });
}
