"use server";
import { revalidatePath } from "next/cache";
import { adminAction } from "@/server/admin/action";
import * as categories from "@/server/admin/categories";

function done() {
  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
  revalidatePath("/catalog");
}
export async function saveCategoryAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await categories.saveCategory(ctx, input);
    if (r.ok) done();
    return r;
  });
}
export async function deleteCategoryAction(input: unknown) {
  return adminAction(async (ctx) => {
    const r = await categories.deleteCategory(ctx, input);
    if (r.ok) done();
    return r;
  });
}
