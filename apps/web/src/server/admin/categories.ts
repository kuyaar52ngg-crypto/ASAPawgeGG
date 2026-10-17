import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { idSchema, slugSchema, slugify } from "@asap/shared";
import { redis } from "@/lib/redis";
import { AdminError, audit, fail, ok, parseInput, type AdminCtx } from "./action";

/** Category.icon values understood by <CategoryIcon/> (components/ui/category-icon.tsx). */
export const CATEGORY_ICONS = ["gamepad-2", "gamepad", "monitor", "joystick", "repeat", "trophy", "bot", "music", "wallet", "gift", "coins", "app-window"] as const;

async function bustCategoryCache() {
  try {
    await redis.del("cache:categories:tree");
  } catch {
    /* best effort: the cache expires after 60 s anyway */
  }
}

const saveSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(2, "Минимум 2 символа").max(60),
  slug: z.string().trim().toLowerCase().max(120).optional().default(""),
  parentId: z.string().max(64).optional().default(""),
  icon: z.string().max(40).optional().default(""),
  description: z.string().trim().max(300).optional().default(""),
  sortOrder: z.coerce.number().int().min(-999).max(9999).default(0),
  isActive: z.boolean().default(true),
});

/** Create or update a category (two levels: root → child). The public tree is cached in Redis for 60 s — busted here. */
export async function saveCategory(ctx: AdminCtx, input: unknown) {
  const p = parseInput(saveSchema, input);
  if (p.error) return p.error;
  const d = p.data;
  const slug = d.slug || slugify(d.name);
  const slugOk = slugSchema.safeParse(slug);
  if (!slugOk.success) return fail("Slug: только латиница, цифры и дефисы", { slug: ["Только латиница, цифры и дефисы"] });
  if (d.icon && !(CATEGORY_ICONS as readonly string[]).includes(d.icon)) return fail("Неизвестная иконка", { icon: ["Неизвестная иконка"] });

  const saved = await prisma.$transaction(async (tx) => {
    const clash = await tx.category.findUnique({ where: { slug }, select: { id: true } });
    if (clash && clash.id !== d.id) throw new AdminError("Категория с таким slug уже есть");

    let parentId: string | null = null;
    if (d.parentId) {
      const parent = await tx.category.findUnique({ where: { id: d.parentId }, select: { id: true, parentId: true } });
      if (!parent) throw new AdminError("Родительская категория не найдена");
      if (parent.parentId) throw new AdminError("Поддерживается только два уровня вложенности");
      if (parent.id === d.id) throw new AdminError("Категория не может быть родителем самой себя");
      parentId = parent.id;
    }
    const data = { name: d.name, slug, parentId, icon: d.icon || null, description: d.description || null, sortOrder: d.sortOrder, isActive: d.isActive };

    if (d.id) {
      const before = await tx.category.findUnique({ where: { id: d.id }, include: { _count: { select: { children: true } } } });
      if (!before) throw new AdminError("Категория не найдена");
      if (parentId && before._count.children > 0) throw new AdminError("У категории есть подкатегории — её нельзя вложить в другую");
      await tx.category.update({ where: { id: d.id }, data });
      await audit(tx, ctx, { action: "category.update", entityType: "Category", entityId: d.id, before: { name: before.name, slug: before.slug, parentId: before.parentId, isActive: before.isActive, sortOrder: before.sortOrder }, after: data });
      return d.id;
    }
    const created = await tx.category.create({ data, select: { id: true } });
    await audit(tx, ctx, { action: "category.create", entityType: "Category", entityId: created.id, after: data });
    return created.id;
  });
  await bustCategoryCache();
  return ok({ id: saved });
}

/** Delete only empty categories (no products, no children) — otherwise deactivate instead. */
export async function deleteCategory(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ id: idSchema }), input);
  if (p.error) return p.error;
  await prisma.$transaction(async (tx) => {
    const c = await tx.category.findUnique({ where: { id: p.data.id }, include: { _count: { select: { products: true, children: true } } } });
    if (!c) throw new AdminError("Категория не найдена");
    if (c._count.products > 0) throw new AdminError(`В категории ${c._count.products} товаров — переместите их или отключите категорию`);
    if (c._count.children > 0) throw new AdminError("Сначала удалите подкатегории");
    await tx.category.delete({ where: { id: c.id } });
    await audit(tx, ctx, { action: "category.delete", entityType: "Category", entityId: c.id, before: { name: c.name, slug: c.slug } });
  });
  await bustCategoryCache();
  return ok();
}
