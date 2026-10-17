import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { idSchema, rubToKopecks } from "@asap/shared";
import { AdminError, audit, fail, ok, parseInput, type AdminCtx } from "./action";

const rub = z.string().trim().regex(/^\d{1,7}([.,]\d{1,2})?$/, "Введите сумму в рублях, например 500");
const optionalInt = (max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d*$/, "Только цифры")
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (v >= 1 && v <= max), `От 1 до ${max}`);

const saveSchema = z.object({
  id: idSchema.optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/, "Код: 3–32 символа, латиница, цифры, _ и -"),
  type: z.enum(["PERCENT", "FIXED"]),
  /** PERCENT: 1..100 (integer); FIXED: rubles */
  value: z.string().trim().regex(/^\d{1,7}([.,]\d{1,2})?$/, "Введите число"),
  minOrder: z.union([z.literal(""), rub]).default(""),
  maxDiscount: z.union([z.literal(""), rub]).default(""),
  maxUses: optionalInt(10_000_000).default(null),
  perUserLimit: z.coerce.number().int().min(1, "Минимум 1").max(1000).default(1),
  /** YYYY-MM-DD (end of that UTC day), empty = never */
  expiresAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")]).default(""),
  isActive: z.boolean().default(true),
});

/** Create or update a promo code. PERCENT value is a whole percent (1–100), FIXED is entered in rubles and stored in kopecks. */
export async function savePromo(ctx: AdminCtx, input: unknown) {
  const p = parseInput(saveSchema, input);
  if (p.error) return p.error;
  const d = p.data;

  let value: number;
  if (d.type === "PERCENT") {
    value = Number(d.value.replace(",", "."));
    if (!Number.isInteger(value) || value < 1 || value > 100) return fail("Процент — целое число от 1 до 100", { value: ["Целое число от 1 до 100"] });
  } else {
    value = rubToKopecks(d.value);
    if (value < 100) return fail("Фиксированная скидка — не менее 1 ₽", { value: ["Не менее 1 ₽"] });
  }
  const data = {
    code: d.code,
    type: d.type,
    value,
    minOrder: d.minOrder ? rubToKopecks(d.minOrder) : 0,
    maxDiscount: d.type === "PERCENT" && d.maxDiscount ? rubToKopecks(d.maxDiscount) : null,
    maxUses: d.maxUses,
    perUserLimit: d.perUserLimit,
    expiresAt: d.expiresAt ? new Date(`${d.expiresAt}T23:59:59.999Z`) : null,
    isActive: d.isActive,
  };

  const id = await prisma.$transaction(async (tx) => {
    const clash = await tx.promoCode.findUnique({ where: { code: d.code }, select: { id: true } });
    if (clash && clash.id !== d.id) throw new AdminError("Промокод с таким кодом уже существует");
    if (d.id) {
      const before = await tx.promoCode.findUnique({ where: { id: d.id } });
      if (!before) throw new AdminError("Промокод не найден");
      if (data.maxUses !== null && data.maxUses < before.usedCount) throw new AdminError(`Лимит не может быть меньше уже использованного (${before.usedCount})`);
      await tx.promoCode.update({ where: { id: d.id }, data });
      await audit(tx, ctx, { action: "promo.update", entityType: "PromoCode", entityId: d.id, before: { code: before.code, type: before.type, value: before.value, isActive: before.isActive, maxUses: before.maxUses }, after: { ...data, expiresAt: data.expiresAt?.toISOString() ?? null } });
      return d.id;
    }
    const created = await tx.promoCode.create({ data, select: { id: true } });
    await audit(tx, ctx, { action: "promo.create", entityType: "PromoCode", entityId: created.id, after: { ...data, expiresAt: data.expiresAt?.toISOString() ?? null } });
    return created.id;
  });
  return ok({ id });
}

export async function togglePromo(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ id: idSchema, isActive: z.boolean() }), input);
  if (p.error) return p.error;
  await prisma.$transaction(async (tx) => {
    const before = await tx.promoCode.findUnique({ where: { id: p.data.id }, select: { isActive: true, code: true } });
    if (!before) throw new AdminError("Промокод не найден");
    await tx.promoCode.update({ where: { id: p.data.id }, data: { isActive: p.data.isActive } });
    await audit(tx, ctx, { action: "promo.toggle", entityType: "PromoCode", entityId: p.data.id, before: { isActive: before.isActive }, after: { isActive: p.data.isActive, code: before.code } });
  });
  return ok();
}

/** Used promo codes are history (orders reference them) — they can only be deactivated; unused ones may be deleted. */
export async function deletePromo(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ id: idSchema }), input);
  if (p.error) return p.error;
  await prisma.$transaction(async (tx) => {
    const promo = await tx.promoCode.findUnique({ where: { id: p.data.id }, include: { _count: { select: { orders: true } } } });
    if (!promo) throw new AdminError("Промокод не найден");
    if (promo.usedCount > 0 || promo._count.orders > 0) throw new AdminError("Промокод уже использовался — его можно только отключить");
    await tx.promoCode.delete({ where: { id: promo.id } });
    await audit(tx, ctx, { action: "promo.delete", entityType: "PromoCode", entityId: promo.id, before: { code: promo.code } });
  });
  return ok();
}
