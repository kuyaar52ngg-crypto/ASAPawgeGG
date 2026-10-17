import "server-only";
import { z } from "zod";
import { getSetting, prisma, type Prisma } from "@asap/db";
import { SETTING_KEYS, idSchema, rubToKopecks } from "@asap/shared";
import { imageUrlSchema } from "@/server/cabinet/images";
import { notify } from "@/server/notifications";
import { enqueueJob } from "@/server/worker";
import { aiComplete } from "./ai";
import { AdminError, audit, fail, ok, parseInput, type ActionResult, type AdminCtx } from "./action";

export interface AiModeration {
  score: number;
  verdict: "approve" | "review" | "reject";
  reasons: string[];
}

/** Defensive reader for Product.aiModeration (written by the worker / seed; shape: { score, verdict, reasons[] }). */
export function readAiModeration(raw: unknown): AiModeration | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const score = Number(r.score);
  const verdict = r.verdict;
  if (!Number.isFinite(score) || (verdict !== "approve" && verdict !== "review" && verdict !== "reject")) return null;
  return { score: Math.max(0, Math.min(100, Math.round(score))), verdict, reasons: Array.isArray(r.reasons) ? r.reasons.map(String).slice(0, 10) : [] };
}

// ───────────────────────── moderation decision ─────────────────────────

const decisionSchema = z.object({
  productId: idSchema,
  decision: z.enum(["approve", "reject", "archive"]),
  reason: z.string().trim().max(500).optional(),
});

/** Approve (→ ACTIVE, publishedAt set once), reject (→ REJECTED, reason shown to the seller) or archive a product. */
export async function moderateProduct(ctx: AdminCtx, input: unknown) {
  const p = parseInput(decisionSchema, input);
  if (p.error) return p.error;
  const { productId, decision, reason } = p.data;
  if (decision === "reject" && !reason) return fail("Укажите причину отклонения — её увидит продавец", { reason: ["Укажите причину"] });

  const res = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, title: true, status: true, sellerId: true, publishedAt: true, moderationNote: true } });
    if (!product) throw new AdminError("Товар не найден");
    const to = decision === "approve" ? "ACTIVE" : decision === "reject" ? "REJECTED" : "ARCHIVED";
    if (product.status === to) throw new AdminError("Товар уже в этом статусе");
    if (decision === "archive" && product.status === "DRAFT") throw new AdminError("Черновик нельзя архивировать");
    await tx.product.update({
      where: { id: productId },
      data: {
        status: to,
        moderationNote: decision === "reject" ? reason : decision === "approve" ? null : product.moderationNote,
        ...(to === "ACTIVE" && !product.publishedAt ? { publishedAt: new Date() } : {}),
      },
    });
    await audit(tx, ctx, { action: `product.${decision}`, entityType: "Product", entityId: productId, before: { status: product.status, moderationNote: product.moderationNote }, after: { status: to, reason: reason ?? null } });
    return { product, to };
  });

  if (decision === "approve") await notify(res.product.sellerId, { type: "PRODUCT_APPROVED", title: "Товар опубликован", body: `«${res.product.title}» прошёл модерацию и доступен покупателям.`, link: "/seller/products" }).catch(() => {});
  if (decision === "reject") await notify(res.product.sellerId, { type: "PRODUCT_REJECTED", title: "Товар отклонён", body: `«${res.product.title}»: ${reason}`, link: "/seller/products" }).catch(() => {});
  return ok({ status: res.to });
}

// ───────────────────────── edit ─────────────────────────

const rubSchema = z.string().trim().regex(/^\d{1,7}([.,]\d{1,2})?$/, "Введите цену в рублях, например 1499 или 1499,50");

const editSchema = z.object({
  productId: idSchema,
  title: z.string().trim().min(3, "Минимум 3 символа").max(160),
  categoryId: idSchema,
  shortDescription: z.string().trim().max(240).optional().default(""),
  description: z.string().trim().min(10, "Опишите товар подробнее").max(10_000),
  platform: z.string().trim().max(40).optional().default(""),
  region: z.string().trim().max(40).optional().default(""),
  tags: z.string().trim().max(400).optional().default(""),
  // same allow-list as seller images (https hosts configured in next.config.ts, or our own /api/art): any other URL would crash next/image
  coverImage: z.union([z.literal(""), imageUrlSchema]).optional().default(""),
  isFeatured: z.boolean().default(false),
  /** base price (ignored when the product has variants) */
  price: rubSchema.optional(),
  oldPrice: z.union([z.literal(""), rubSchema]).optional().default(""),
  variants: z.array(z.object({ id: idSchema, price: rubSchema, isActive: z.boolean() })).max(50).default([]),
});

/** Admin edit of a listing. Product.price stays in sync with the cheapest active variant (CONTRACTS §6). */
export async function updateProduct(ctx: AdminCtx, input: unknown) {
  const p = parseInput(editSchema, input);
  if (p.error) return p.error;
  const d = p.data;

  await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: d.productId }, include: { variants: true } });
    if (!product) throw new AdminError("Товар не найден");
    if (!(await tx.category.findUnique({ where: { id: d.categoryId }, select: { id: true } }))) throw new AdminError("Категория не найдена");

    let price = product.price;
    if (product.variants.length > 0) {
      for (const v of d.variants) {
        const existing = product.variants.find((x) => x.id === v.id);
        if (!existing) throw new AdminError("Вариант не относится к этому товару");
        const kop = rubToKopecks(v.price);
        if (kop < 100) throw new AdminError("Цена варианта — не менее 1 ₽");
        if (kop !== existing.price || v.isActive !== existing.isActive) await tx.productVariant.update({ where: { id: v.id }, data: { price: kop, isActive: v.isActive } });
      }
      const fresh = await tx.productVariant.findMany({ where: { productId: product.id }, select: { price: true, isActive: true } });
      const active = fresh.filter((v) => v.isActive);
      if (active.length === 0 && product.status === "ACTIVE") throw new AdminError("У активного товара должен остаться хотя бы один активный вариант");
      price = Math.min(...(active.length ? active : fresh).map((v) => v.price));
    } else {
      if (!d.price) throw new AdminError("Укажите цену");
      price = rubToKopecks(d.price);
      if (price < 100) throw new AdminError("Цена — не менее 1 ₽");
    }
    const oldPrice = d.oldPrice ? rubToKopecks(d.oldPrice) : null;
    if (oldPrice !== null && oldPrice <= price) throw new AdminError("Старая цена должна быть выше текущей");

    const data: Prisma.ProductUpdateInput = {
      title: d.title,
      category: { connect: { id: d.categoryId } },
      shortDescription: d.shortDescription || null,
      description: d.description,
      platform: d.platform ? d.platform.toUpperCase() : null,
      region: d.region ? d.region.toUpperCase() : null,
      tags: d.tags ? [...new Set(d.tags.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 15) : [],
      coverImage: d.coverImage || null,
      isFeatured: d.isFeatured,
      price,
      oldPrice,
    };
    await tx.product.update({ where: { id: d.productId }, data });
    await audit(tx, ctx, {
      action: "product.edit",
      entityType: "Product",
      entityId: d.productId,
      before: { title: product.title, price: product.price, oldPrice: product.oldPrice, categoryId: product.categoryId, isFeatured: product.isFeatured },
      after: { title: d.title, price, oldPrice, categoryId: d.categoryId, isFeatured: d.isFeatured },
    });
  });
  return ok();
}

// ───────────────────────── AI moderation (re-run) ─────────────────────────

const FORBIDDEN_RE = /взлом|(?<![а-яё])чит(?:ы|а|ами|ов)?(?![а-яё])|накрутк|кардинг|краден|слив\s+баз|брутфорс|ddos|\bcvv\b|дамп[ыа]?\s+карт|подделк|фальшив|читерск/i;

/** Deterministic rule-based moderation used when no LLM is available (clearly labelled `mock`). */
export function ruleBasedModeration(p: { title: string; description: string; price: number; imagesCount: number }): AiModeration {
  const reasons: string[] = [];
  let score = 92;
  if (FORBIDDEN_RE.test(`${p.title}\n${p.description}`)) {
    return { score: 5, verdict: "reject", reasons: ["Обнаружены признаки запрещённого товара или услуги"] };
  }
  if (p.description.trim().length < 80) {
    score -= 25;
    reasons.push("Слишком короткое описание");
  }
  if (p.price < 5000) {
    score -= 10;
    reasons.push("Подозрительно низкая цена");
  }
  if (p.title === p.title.toUpperCase() && /[A-ZА-Я]{6,}/.test(p.title)) {
    score -= 8;
    reasons.push("Заголовок написан капсом");
  }
  if (p.imagesCount === 0) {
    score -= 8;
    reasons.push("Нет изображений");
  }
  score = Math.max(0, score);
  return { score, verdict: score >= 80 ? "approve" : score >= 50 ? "review" : "reject", reasons: reasons.length ? reasons : ["Замечаний нет"] };
}

const aiJsonSchema = z.object({ score: z.coerce.number().min(0).max(100), verdict: z.enum(["approve", "review", "reject"]), reasons: z.array(z.string()).max(10).default([]) });

/**
 * «Перепроверить AI»: enqueue the worker's `ai_moderate_product` job; when the worker is unreachable run the moderation
 * inline through the configured LLM (or the rule-based fallback) and store the verdict in Product.aiModeration.
 * The verdict never changes the product status by itself — the admin decides.
 */
export async function rerunAiModeration(ctx: AdminCtx, input: unknown): Promise<ActionResult<Record<string, unknown>>> {
  const p = parseInput(z.object({ productId: idSchema }), input);
  if (p.error) return p.error;
  const product = await prisma.product.findUnique({ where: { id: p.data.productId }, select: { id: true, title: true, description: true, shortDescription: true, price: true, images: true, coverImage: true, tags: true, type: true, category: { select: { name: true } } } });
  if (!product) return fail("Товар не найден");

  const queued = await enqueueJob("ai_moderate_product", { productId: product.id });
  if (queued.ok) {
    await prisma.auditLog.create({ data: { actorId: ctx.admin.id, action: "product.ai_recheck", entityType: "Product", entityId: product.id, after: { via: "worker", jobId: queued.jobId ?? null }, ip: ctx.ip } });
    return ok({ via: "worker" as const });
  }

  const input2 = { title: product.title, productId: product.id };
  const fallbackVerdict = ruleBasedModeration({ title: product.title, description: product.description, price: product.price, imagesCount: product.images.length + (product.coverImage ? 1 : 0) });
  const r = await aiComplete({
    task: "moderation",
    userId: ctx.admin.id,
    logInput: input2,
    system:
      "Ты модератор маркетплейса цифровых товаров (игры, ключи, подписки, пополнение). Оцени карточку товара: запрещённые товары (читы, взлом, краденые аккаунты и карты, " +
      "поддельные документы), качество описания, соответствие категории, подозрительная цена. Ответь ТОЛЬКО JSON без пояснений: " +
      '{"score": 0-100, "verdict": "approve"|"review"|"reject", "reasons": ["краткие причины по-русски"]}.',
    prompt: `Категория: ${product.category.name}\nТип: ${product.type}\nНазвание: ${product.title}\nЦена: ${(product.price / 100).toFixed(2)} RUB\nТеги: ${product.tags.join(", ")}\nОписание:\n${product.description.slice(0, 3000)}`,
    fallback: () => JSON.stringify(fallbackVerdict),
  });

  let verdict: AiModeration = fallbackVerdict;
  try {
    const m = r.text.match(/\{[\s\S]*\}/);
    verdict = aiJsonSchema.parse(JSON.parse(m ? m[0] : r.text));
  } catch {
    verdict = fallbackVerdict;
  }
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: product.id }, data: { aiModeration: { ...verdict, provider: r.provider, model: r.model, mock: r.mock, checkedAt: new Date().toISOString() } } });
    await audit(tx, ctx, { action: "product.ai_recheck", entityType: "Product", entityId: product.id, after: { via: "inline", provider: r.provider, ...verdict } });
  });
  return ok({ via: "inline" as const, ...verdict, mock: r.mock });
}

/** Threshold above which AI auto-publishes (shown next to the verdict in the queue). */
export async function getAutoPublishThreshold(): Promise<number> {
  const v = Number(await getSetting<number>(SETTING_KEYS.aiAutoPublish, 80).catch(() => 80));
  return Number.isFinite(v) ? v : 80;
}
