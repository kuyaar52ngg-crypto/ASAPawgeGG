import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { decryptStock, encryptStock, idSchema, stockFingerprint } from "@asap/shared";
import type { SellerCtx } from "./seller-context";
import { fail, ok, zodFail, type ActionResult } from "./result";

export const MAX_STOCK_BATCH = 5000;
export const MAX_STOCK_ITEM_LENGTH = 4000;

const uploadSchema = z.object({
  productId: idSchema,
  variantId: idSchema.nullish(),
  /** one key per entry (the UI splits textarea lines / CSV rows) */
  items: z.array(z.string().max(MAX_STOCK_ITEM_LENGTH * 2)).min(1, "Добавьте хотя бы один ключ").max(MAX_STOCK_BATCH, `За один раз можно загрузить до ${MAX_STOCK_BATCH} ключей`),
});

export interface StockUploadSummary {
  added: number;
  /** repeated inside the uploaded list */
  duplicatesInBatch: number;
  /** already present in this product's stock (sold, reserved or available) */
  duplicatesExisting: number;
  /** empty or longer than the limit */
  rejected: number;
}

/** Loads a product owned by the seller together with its active variants. */
export async function loadOwnedProduct(sellerId: string, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, sellerId },
    select: { id: true, title: true, status: true, deliveryMode: true, variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true } } },
  });
}

/** Encrypts (AES-256-GCM, CONTRACTS §11) and stores keys; duplicates (by sha256 fingerprint) are skipped. */
export async function uploadStock(ctx: SellerCtx, raw: unknown): Promise<ActionResult<StockUploadSummary>> {
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const product = await loadOwnedProduct(ctx.user.id, parsed.data.productId);
  if (!product) return fail("Товар не найден");
  if (product.deliveryMode !== "AUTO_STOCK") return fail("Склад ключей используется только для товаров с мгновенной выдачей");
  let variantId: string | null = null;
  if (product.variants.length > 0) {
    if (!parsed.data.variantId || !product.variants.some((v) => v.id === parsed.data.variantId)) return fail("Выберите вариант товара, для которого загружаете ключи", { variantId: ["Выберите вариант"] });
    variantId = parsed.data.variantId;
  } else if (parsed.data.variantId) return fail("У этого товара нет вариантов");

  let rejected = 0;
  let duplicatesInBatch = 0;
  const unique = new Map<string, string>(); // fingerprint -> plaintext
  for (const item of parsed.data.items) {
    const text = item.trim();
    if (!text || text.length > MAX_STOCK_ITEM_LENGTH) {
      rejected++;
      continue;
    }
    const fp = stockFingerprint(text);
    if (unique.has(fp)) duplicatesInBatch++;
    else unique.set(fp, text);
  }
  if (unique.size === 0) return fail("Нет подходящих ключей: все строки пустые или слишком длинные");

  const existing = await prisma.stockItem.findMany({ where: { productId: product.id, fingerprint: { in: [...unique.keys()] } }, select: { fingerprint: true } });
  const existingSet = new Set(existing.map((e) => e.fingerprint));
  const fresh = [...unique].filter(([fp]) => !existingSet.has(fp));

  let added = 0;
  if (fresh.length > 0) {
    const res = await prisma.stockItem.createMany({
      data: fresh.map(([fingerprint, text]) => ({ productId: product.id, variantId, payloadEnc: encryptStock(text), fingerprint })),
      skipDuplicates: true,
    });
    added = res.count;
  }
  return ok({ added, duplicatesInBatch, duplicatesExisting: unique.size - fresh.length + (fresh.length - added), rejected });
}

const deleteSchema = z.union([
  z.object({ productId: idSchema, ids: z.array(idSchema).min(1).max(1000) }),
  z.object({ productId: idSchema, all: z.literal(true), variantId: idSchema.nullish() }),
]);

/** Deletes UNSOLD (AVAILABLE) keys only — reserved and sold keys belong to buyers' orders and are never touched. */
export async function deleteUnsoldStock(ctx: SellerCtx, raw: unknown): Promise<ActionResult<{ deleted: number }>> {
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const product = await loadOwnedProduct(ctx.user.id, parsed.data.productId);
  if (!product) return fail("Товар не найден");
  const where = "ids" in parsed.data
    ? { productId: product.id, id: { in: parsed.data.ids }, status: "AVAILABLE" as const }
    : { productId: product.id, status: "AVAILABLE" as const, ...(parsed.data.variantId ? { variantId: parsed.data.variantId } : {}) };
  const res = await prisma.stockItem.deleteMany({ where });
  return ok({ deleted: res.count });
}

export interface StockOverview {
  total: { AVAILABLE: number; RESERVED: number; SOLD: number };
  byVariant: { variantId: string | null; title: string; AVAILABLE: number; RESERVED: number; SOLD: number }[];
}

export async function getStockOverview(productId: string, variants: { id: string; title: string }[]): Promise<StockOverview> {
  const rows = await prisma.stockItem.groupBy({ by: ["variantId", "status"], where: { productId }, _count: { _all: true } });
  const total = { AVAILABLE: 0, RESERVED: 0, SOLD: 0 };
  const map = new Map<string | null, { AVAILABLE: number; RESERVED: number; SOLD: number }>();
  for (const r of rows) {
    total[r.status] += r._count._all;
    const cur = map.get(r.variantId) ?? { AVAILABLE: 0, RESERVED: 0, SOLD: 0 };
    cur[r.status] += r._count._all;
    map.set(r.variantId, cur);
  }
  const entries = variants.length > 0 ? variants.map((v) => ({ variantId: v.id as string | null, title: v.title })) : [{ variantId: null, title: "Все ключи" }];
  const byVariant = entries.map((e) => ({ ...e, ...(map.get(e.variantId) ?? { AVAILABLE: 0, RESERVED: 0, SOLD: 0 }) }));
  // keys that belong to a since-removed variant
  const orphan = map.get(null);
  if (variants.length > 0 && orphan) byVariant.push({ variantId: null, title: "Без варианта", ...orphan });
  return { total, byVariant };
}

/** `AB12••••XY9` — enough for the seller to recognise a key, never the full secret. */
export function maskSecret(s: string): string {
  const t = s.trim();
  if (t.length <= 6) return `${t.slice(0, 1)}•••••`;
  if (t.length <= 12) return `${t.slice(0, 2)}••••${t.slice(-2)}`;
  return `${t.slice(0, 4)}••••••${t.slice(-3)}`;
}

export interface UnsoldRow {
  id: string;
  masked: string;
  variantTitle: string | null;
  createdAt: Date;
}

/** One page of AVAILABLE keys with masked previews (decrypted only server-side to build the mask). */
export async function listUnsold(productId: string, variants: { id: string; title: string }[], page: number, pageSize = 50): Promise<{ rows: UnsoldRow[]; total: number }> {
  const where = { productId, status: "AVAILABLE" as const };
  const [total, items] = await Promise.all([
    prisma.stockItem.count({ where }),
    prisma.stockItem.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, variantId: true, payloadEnc: true, createdAt: true } }),
  ]);
  const vt = new Map(variants.map((v) => [v.id, v.title]));
  return {
    total,
    rows: items.map((i) => {
      let masked = "••••••";
      try {
        masked = maskSecret(decryptStock(i.payloadEnc));
      } catch {
        /* unreadable key — show placeholder */
      }
      return { id: i.id, masked, variantTitle: i.variantId ? (vt.get(i.variantId) ?? null) : null, createdAt: i.createdAt };
    }),
  };
}
