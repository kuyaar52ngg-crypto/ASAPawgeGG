import "server-only";
import { Prisma, prisma } from "@asap/db";
import { idSchema, slugify } from "@asap/shared";
import { enqueueJob } from "@/server/worker";
import type { SellerCtx } from "./seller-context";
import { productFormSchema, type ProductFormData } from "./product-schema";
import { fail, ok, zodFail, type ActionResult } from "./result";

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "product";
  for (let i = 0; i < 8; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await prisma.product.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const activationOf = (instructions: string) =>
  instructions
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 20);

/** Stable fingerprint of the fields that require re-moderation when an ACTIVE product changes. */
function contentKey(p: { title: string; categoryId: string; type: string; platform?: string | null; region?: string | null; shortDescription?: string | null; description: string; images: string[]; activation: string[]; variantTitles: string[] }): string {
  return JSON.stringify([p.title, p.categoryId, p.type, p.platform ?? null, p.region ?? null, p.shortDescription ?? null, p.description, p.images, p.activation, p.variantTitles]);
}

export interface SaveProductOutcome {
  id: string;
  status: string;
  /** moderation job accepted by the worker (false => stays in the admin queue) */
  queued: boolean;
  message: string;
}

/** Create (productId = null) or update a product owned by the seller. All input is validated; ownership is enforced. */
export async function saveProduct(ctx: SellerCtx, productId: string | null, raw: unknown): Promise<ActionResult<SaveProductOutcome>> {
  const parsed = productFormSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const input: ProductFormData = parsed.data;
  if (input.intent === "submit" && !ctx.verified) return fail("Отправлять товары на модерацию можно после подтверждения профиля администратором. Пока можно сохранить черновик.");

  const category = await prisma.category.findFirst({ where: { id: input.categoryId, isActive: true }, select: { id: true } });
  if (!category) return fail("Выберите категорию", { categoryId: ["Категория не найдена"] });

  const activation = activationOf(input.instructions);
  const activeVariants = input.variants.filter((v) => v.isActive);
  const minVariant = activeVariants.length ? activeVariants.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const price = minVariant ? minVariant.price : input.price;
  const oldPrice = minVariant ? (minVariant.oldPrice ?? null) : (input.oldPrice ?? null);
  const images = [...new Set(input.images)];

  let existing: Awaited<ReturnType<typeof loadOwned>> = null;
  if (productId) {
    const id = idSchema.safeParse(productId);
    if (!id.success) return fail("Товар не найден");
    existing = await loadOwned(ctx.user.id, id.data);
    if (!existing) return fail("Товар не найден");
  }

  const attrsBase = (existing?.attributes && typeof existing.attributes === "object" && !Array.isArray(existing.attributes) ? existing.attributes : {}) as Record<string, unknown>;
  const { activation: _old, ...attrsRest } = attrsBase;
  void _old;
  const attributes = (activation.length ? { ...attrsRest, activation } : attrsRest) as Prisma.InputJsonObject;

  // decide the resulting status
  const newKey = contentKey({ ...input, images, activation, variantTitles: input.variants.map((v) => v.title) });
  let status: "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "REJECTED" | "ARCHIVED";
  let moderate = false;
  if (!existing) {
    status = input.intent === "submit" ? "PENDING_REVIEW" : "DRAFT";
    moderate = status === "PENDING_REVIEW";
  } else {
    const oldKey = contentKey({
      title: existing.title, categoryId: existing.categoryId, type: existing.type, platform: existing.platform, region: existing.region, shortDescription: existing.shortDescription,
      description: existing.description, images: existing.images, activation: Array.isArray(attrsBase.activation) ? (attrsBase.activation as string[]) : [], variantTitles: existing.variants.map((v) => v.title),
    });
    const changed = oldKey !== newKey;
    switch (existing.status) {
      case "ACTIVE":
        status = changed ? "PENDING_REVIEW" : "ACTIVE";
        moderate = changed;
        break;
      case "PENDING_REVIEW":
        status = "PENDING_REVIEW";
        moderate = changed;
        break;
      case "ARCHIVED":
        status = input.intent === "submit" ? "PENDING_REVIEW" : "ARCHIVED";
        moderate = input.intent === "submit";
        break;
      default: // DRAFT, REJECTED
        status = input.intent === "submit" ? "PENDING_REVIEW" : "DRAFT";
        moderate = input.intent === "submit";
    }
  }
  if (status === "PENDING_REVIEW" && !ctx.verified) {
    // an ACTIVE product of a (now) unverified seller edited => keep it simple and refuse
    return fail("Редактирование опубликованного товара доступно только подтверждённому продавцу");
  }

  const data = {
    categoryId: input.categoryId,
    title: input.title,
    shortDescription: input.shortDescription || null,
    description: input.description,
    type: input.type,
    deliveryMode: input.deliveryMode,
    platform: input.platform ?? null,
    region: input.region ?? null,
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
    coverImage: images[0] ?? null,
    images,
    tags: [...new Set(input.tags)],
    attributes,
    status,
    ...(moderate ? { aiModeration: Prisma.DbNull, moderationNote: null } : {}),
  } satisfies Prisma.ProductUncheckedUpdateInput;

  const saved = await prisma.$transaction(async (tx) => {
    let id: string;
    if (existing) {
      id = existing.id;
      await tx.product.update({ where: { id }, data });
    } else {
      const created = await tx.product.create({ data: { ...data, sellerId: ctx.user.id, slug: await uniqueSlug(input.title) }, select: { id: true } });
      id = created.id;
    }
    await syncVariants(tx, id, input.variants);
    return id;
  });

  let queued = false;
  if (moderate) queued = (await enqueueJob("ai_moderate_product", { productId: saved })).ok;

  const message =
    status === "PENDING_REVIEW"
      ? queued
        ? "Товар отправлен на модерацию. AI-проверка обычно занимает до минуты."
        : "Товар отправлен на модерацию. Автопроверка сейчас недоступна — товар проверит администратор."
      : status === "ACTIVE"
        ? "Изменения сохранены."
        : "Черновик сохранён.";
  return ok({ id: saved, status, queued, message });
}

async function loadOwned(sellerId: string, id: string) {
  return prisma.product.findFirst({ where: { id, sellerId }, include: { variants: { select: { id: true, title: true } } } });
}

/** Upserts the submitted variants; variants removed from the form are deleted, or deactivated when they have history/stock. */
async function syncVariants(tx: Prisma.TransactionClient, productId: string, variants: ProductFormData["variants"]) {
  const current = await tx.productVariant.findMany({ where: { productId }, select: { id: true, _count: { select: { orderItems: true, stockItems: true } } } });
  const currentIds = new Set(current.map((c) => c.id));
  const keep = new Set<string>();
  for (const [i, v] of variants.entries()) {
    const row = { title: v.title, price: v.price, oldPrice: v.oldPrice && v.oldPrice > v.price ? v.oldPrice : null, isActive: v.isActive, sortOrder: i };
    if (v.id && currentIds.has(v.id)) {
      keep.add(v.id);
      await tx.productVariant.update({ where: { id: v.id }, data: row });
    } else {
      const created = await tx.productVariant.create({ data: { ...row, productId }, select: { id: true } });
      keep.add(created.id);
    }
  }
  for (const c of current) {
    if (keep.has(c.id)) continue;
    if (c._count.orderItems > 0 || c._count.stockItems > 0) await tx.productVariant.update({ where: { id: c.id }, data: { isActive: false } });
    else await tx.productVariant.delete({ where: { id: c.id } });
  }
}

export async function archiveProduct(ctx: SellerCtx, rawId: unknown): Promise<ActionResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return fail("Товар не найден");
  const res = await prisma.product.updateMany({ where: { id: id.data, sellerId: ctx.user.id, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED" } });
  return res.count === 1 ? ok() : fail("Товар не найден или уже в архиве");
}

/** Archived -> DRAFT (must be re-submitted for moderation). */
export async function restoreProduct(ctx: SellerCtx, rawId: unknown): Promise<ActionResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return fail("Товар не найден");
  const res = await prisma.product.updateMany({ where: { id: id.data, sellerId: ctx.user.id, status: "ARCHIVED" }, data: { status: "DRAFT" } });
  return res.count === 1 ? ok() : fail("Товар не найден или не в архиве");
}

/** Hard delete — only for products that were never sold. */
export async function deleteProduct(ctx: SellerCtx, rawId: unknown): Promise<ActionResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return fail("Товар не найден");
  const p = await prisma.product.findFirst({ where: { id: id.data, sellerId: ctx.user.id }, select: { id: true, _count: { select: { orderItems: true } } } });
  if (!p) return fail("Товар не найден");
  if (p._count.orderItems > 0) return fail("У товара есть заказы — его нельзя удалить, но можно отправить в архив");
  await prisma.product.delete({ where: { id: p.id } });
  return ok();
}
