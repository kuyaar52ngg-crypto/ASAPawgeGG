import "server-only";
import { prisma, getSetting } from "@asap/db";
import { SETTING_KEYS, STEAM_TOPUP_DEFAULT_FEE_PERCENT } from "@asap/shared";

export interface SteamPreset {
  variantId: string;
  title: string;
  /** wallet amount in the wallet currency (whole units) */
  amount: number;
  /** price the buyer pays, kopecks */
  price: number;
}

export interface SteamTarget {
  productId: string;
  slug: string;
  title: string;
  currency: "RUB" | "KZT";
  region: string;
  /** free amount allowed (RUB only: price = quote(amount, fee)) */
  customAllowed: boolean;
  presets: SteamPreset[];
}

export interface SteamConfig {
  feePercent: number;
  rub: SteamTarget | null;
  kzt: SteamTarget | null;
}

export async function getSteamFeePercent(): Promise<number> {
  const v = await getSetting<number | string>(SETTING_KEYS.steamTopupFeePercent, STEAM_TOPUP_DEFAULT_FEE_PERCENT).catch(() => STEAM_TOPUP_DEFAULT_FEE_PERCENT);
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : STEAM_TOPUP_DEFAULT_FEE_PERCENT;
}

async function loadTarget(region: "RU" | "KZ", currency: "RUB" | "KZT"): Promise<SteamTarget | null> {
  const p = await prisma.product.findFirst({
    where: { status: "ACTIVE", type: "TOPUP", platform: "STEAM", region },
    orderBy: { salesCount: "desc" },
    select: { id: true, slug: true, title: true, region: true, variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true, price: true, attributes: true } } },
  });
  if (!p) return null;
  const key = currency === "RUB" ? "amountRub" : "amountKzt";
  const presets: SteamPreset[] = p.variants
    .map((v) => ({ variantId: v.id, title: v.title, amount: Number((v.attributes as Record<string, unknown> | null)?.[key]), price: v.price }))
    .filter((v) => Number.isFinite(v.amount) && v.amount > 0);
  return { productId: p.id, slug: p.slug, title: p.title, currency, region, customAllowed: currency === "RUB", presets };
}

/** Steam top-up products + fee, straight from the DB (Settings + TOPUP products). */
export async function getSteamConfig(): Promise<SteamConfig> {
  const [feePercent, rub, kzt] = await Promise.all([getSteamFeePercent(), loadTarget("RU", "RUB"), loadTarget("KZ", "KZT")]);
  return { feePercent, rub, kzt };
}
