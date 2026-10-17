import "server-only";
import { z } from "zod";
import { getSetting, prisma } from "@asap/db";
import { DEFAULT_COMMISSION_BPS, DEFAULT_HOLD_DAYS, SETTING_KEYS, STEAM_TOPUP_DEFAULT_FEE_PERCENT } from "@asap/shared";
import { env } from "@/lib/env";
import { redis } from "@/lib/redis";
import { AdminError, audit, fail, ok, parseInput, type AdminCtx } from "./action";

export const SETTINGS_SECTIONS = ["commission", "ai", "analytics", "payments"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const AI_PROVIDER_OPTIONS = [
  { value: "mock", label: "Mock (без внешнего API, для тестов)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "openrouter", label: "OpenRouter" },
] as const;

export interface PlatformSettings {
  commissionPercent: string;
  holdDays: number;
  steamFeePercent: string;
  aiProvider: string;
  aiModel: string;
  aiThreshold: number;
  ymId: string;
  payments: Record<"PLATEGA" | "ROLLYPAY" | "BALANCE" | "SANDBOX", boolean>;
}

const pct = (n: number) => String(n).replace(".", ",");

/** Current values with the same fallbacks the rest of the app uses (env / constants). */
export async function loadSettings(): Promise<PlatformSettings> {
  const [bps, holdDays, steamFee, aiProvider, aiModel, aiThreshold, ymId, enabled] = await Promise.all([
    getSetting<number>(SETTING_KEYS.commissionDefaultBps, env.commissionDefaultBps || DEFAULT_COMMISSION_BPS),
    getSetting<number>(SETTING_KEYS.holdDays, env.holdDays || DEFAULT_HOLD_DAYS),
    getSetting<number | string>(SETTING_KEYS.steamTopupFeePercent, STEAM_TOPUP_DEFAULT_FEE_PERCENT),
    getSetting<string>(SETTING_KEYS.aiProvider, env.ai.provider),
    getSetting<string>(SETTING_KEYS.aiModel, env.ai.model),
    getSetting<number>(SETTING_KEYS.aiAutoPublish, 80),
    getSetting<string | number>(SETTING_KEYS.ymId, process.env.NEXT_PUBLIC_YM_ID ?? ""),
    getSetting<Partial<Record<"PLATEGA" | "ROLLYPAY" | "BALANCE" | "SANDBOX", boolean>>>(SETTING_KEYS.paymentsEnabled, {}),
  ]);
  return {
    commissionPercent: pct(Number(bps) / 100),
    holdDays: Number(holdDays),
    steamFeePercent: pct(Number(steamFee)),
    aiProvider: String(aiProvider || "mock"),
    aiModel: String(aiModel ?? ""),
    aiThreshold: Number(aiThreshold),
    ymId: String(ymId ?? ""),
    payments: { PLATEGA: enabled.PLATEGA !== false, ROLLYPAY: enabled.ROLLYPAY !== false, BALANCE: enabled.BALANCE !== false, SANDBOX: enabled.SANDBOX !== false },
  };
}

const percent = (max: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,2}([.,]\d{1,2})?$/, `${label}: число, например 10 или 7,5`)
    .transform((v) => Number(v.replace(",", ".")))
    .refine((v) => v >= 0 && v <= max, `${label}: от 0 до ${max}`);

const sectionSchemas = {
  commission: z.object({
    commissionPercent: percent(50, "Комиссия"),
    holdDays: z.coerce.number().int("Целое число дней").min(0).max(60, "Не более 60 дней"),
    steamFeePercent: percent(30, "Комиссия Steam"),
  }),
  ai: z.object({
    aiProvider: z.enum(AI_PROVIDER_OPTIONS.map((o) => o.value) as [string, ...string[]]),
    aiModel: z.string().trim().max(80),
    aiThreshold: z.coerce.number().int().min(0).max(100, "Порог — от 0 до 100"),
  }),
  analytics: z.object({ ymId: z.union([z.literal(""), z.string().trim().regex(/^\d{4,12}$/, "ID счётчика — число из 4–12 цифр")]) }),
  payments: z.object({ PLATEGA: z.boolean(), ROLLYPAY: z.boolean(), BALANCE: z.boolean(), SANDBOX: z.boolean() }),
} as const;

/**
 * Save one settings section into the `Setting` table (keys from SETTING_KEYS) and audit before/after.
 * Money-affecting values (commission, hold, Steam fee) apply to NEW orders only — existing orders keep their snapshots.
 */
export async function saveSettings(ctx: AdminCtx, input: unknown) {
  const head = parseInput(z.object({ section: z.enum(SETTINGS_SECTIONS), values: z.record(z.string(), z.unknown()) }), input);
  if (head.error) return head.error;
  const { section, values } = head.data;
  const parsed = sectionSchemas[section].safeParse(values);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return fail(parsed.error.issues[0]?.message ?? "Проверьте значения", flat.fieldErrors as Record<string, string[] | undefined>);
  }
  const before = await loadSettings();
  const writes: [string, unknown][] = [];

  if (section === "commission") {
    const v = parsed.data as z.infer<(typeof sectionSchemas)["commission"]>;
    writes.push([SETTING_KEYS.commissionDefaultBps, Math.round(v.commissionPercent * 100)], [SETTING_KEYS.holdDays, v.holdDays], [SETTING_KEYS.steamTopupFeePercent, v.steamFeePercent]);
  } else if (section === "ai") {
    const v = parsed.data as z.infer<(typeof sectionSchemas)["ai"]>;
    writes.push([SETTING_KEYS.aiProvider, v.aiProvider], [SETTING_KEYS.aiModel, v.aiModel], [SETTING_KEYS.aiAutoPublish, v.aiThreshold]);
  } else if (section === "analytics") {
    const v = parsed.data as z.infer<(typeof sectionSchemas)["analytics"]>;
    writes.push([SETTING_KEYS.ymId, v.ymId]);
  } else {
    const v = parsed.data as z.infer<(typeof sectionSchemas)["payments"]>;
    if (!v.PLATEGA && !v.ROLLYPAY && !v.SANDBOX && !v.BALANCE) throw new AdminError("Должен быть включён хотя бы один способ оплаты");
    if (!v.PLATEGA && !v.ROLLYPAY && !v.SANDBOX) throw new AdminError("Включите хотя бы один платёжный шлюз — иначе покупатели не смогут пополнять баланс");
    writes.push([SETTING_KEYS.paymentsEnabled, v]);
  }

  await prisma.$transaction(async (tx) => {
    for (const [key, value] of writes) {
      await tx.setting.upsert({ where: { key }, create: { key, value: value as never, updatedById: ctx.admin.id }, update: { value: value as never, updatedById: ctx.admin.id } });
    }
    await audit(tx, ctx, {
      action: "settings.update",
      entityType: "Setting",
      entityId: section,
      before: pickBefore(section, before) as never,
      after: Object.fromEntries(writes) as never,
    });
  });
  try {
    await redis.del("cache:analytics:config");
  } catch {
    /* best effort */
  }
  return ok();
}

function pickBefore(section: SettingsSection, s: PlatformSettings) {
  switch (section) {
    case "commission":
      return { commissionPercent: s.commissionPercent, holdDays: s.holdDays, steamFeePercent: s.steamFeePercent };
    case "ai":
      return { aiProvider: s.aiProvider, aiModel: s.aiModel, aiThreshold: s.aiThreshold };
    case "analytics":
      return { ymId: s.ymId };
    case "payments":
      return s.payments;
  }
}
