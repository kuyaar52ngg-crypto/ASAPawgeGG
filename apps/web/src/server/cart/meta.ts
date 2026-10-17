import { z } from "zod";
import { STEAM_TOPUP_MAX_KOPECKS, STEAM_TOPUP_MIN_KOPECKS } from "@asap/shared";

/**
 * Buyer-supplied delivery input stored in CartItem.meta / OrderItem.meta (same keys the storefront bridge writes,
 * see CONTRACTS §20-A/§20-B). Only these keys are ever persisted:
 *   steamLogin      Steam account login for TOPUP products
 *   amountKopecks   custom Steam wallet amount (kopecks CREDITED to the wallet) for TOPUP lines without a variant
 *   buyerInput      free-form delivery data (UID / login / email) for MANUAL products
 */
export const steamLoginSchema = z
  .string()
  .trim()
  .min(3, "Логин Steam — минимум 3 символа")
  .max(64, "Логин Steam слишком длинный")
  .regex(/^[A-Za-z0-9_.-]+$/, "Логин Steam: только латиница, цифры, _ . -");

export const buyerInputSchema = z.string().trim().min(2, "Укажите данные для выдачи").max(200, "Максимум 200 символов");

export const itemMetaSchema = z
  .object({
    steamLogin: steamLoginSchema.optional(),
    amountKopecks: z.number().int().min(STEAM_TOPUP_MIN_KOPECKS).max(STEAM_TOPUP_MAX_KOPECKS).optional(),
    buyerInput: buyerInputSchema.optional(),
  })
  .strip();

export type ItemMeta = z.infer<typeof itemMetaSchema>;
export type RequiredInput = "steamLogin" | "buyerInput" | null;

/** Which buyer input a product needs before it can be ordered. */
export function requiredInput(p: { type: string; deliveryMode: string; platform?: string | null }): RequiredInput {
  if (p.type === "TOPUP") return p.platform === "STEAM" ? "steamLogin" : "buyerInput";
  if (p.deliveryMode === "MANUAL") return "buyerInput";
  return null;
}

export const INPUT_LABELS: Record<Exclude<RequiredInput, null>, { label: string; placeholder: string; hint: string }> = {
  steamLogin: { label: "Логин Steam", placeholder: "например, my_steam_login", hint: "Именно логин для входа (не email и не никнейм в профиле)" },
  buyerInput: { label: "Данные для выдачи", placeholder: "UID / логин / email аккаунта", hint: "Продавец выполнит заказ по этим данным" },
};

/** Parse + whitelist raw meta. Returns null for empty. */
export function parseItemMeta(raw: unknown): { ok: true; meta: ItemMeta | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, meta: null };
  const parsed = itemMetaSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Некорректные данные" };
  const meta = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== "")) as ItemMeta;
  return { ok: true, meta: Object.keys(meta).length ? meta : null };
}

/** True when the stored meta satisfies the product's required input. */
export function hasRequiredInput(req: RequiredInput, meta: unknown): boolean {
  if (!req) return true;
  const parsed = itemMetaSchema.safeParse(meta ?? {});
  return parsed.success && Boolean(parsed.data[req]);
}

/** Stable key to merge identical cart lines. */
export function metaKey(meta: unknown): string {
  const parsed = itemMetaSchema.safeParse(meta ?? {});
  if (!parsed.success) return "";
  const d = parsed.data;
  return JSON.stringify([d.steamLogin ?? "", d.amountKopecks ?? 0, d.buyerInput ?? ""]);
}
