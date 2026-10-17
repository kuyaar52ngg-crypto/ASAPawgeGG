import { z } from "zod";
import { PLATFORMS, PRODUCT_TYPES, REGIONS, idSchema } from "@asap/shared";
import { imageUrlSchema } from "./images";

/** Delivery modes a seller may choose. AUTO_PROVIDER (platform supplier, e.g. Steam top-up) is not self-service. */
export const SELLER_DELIVERY_MODES = ["AUTO_STOCK", "MANUAL"] as const;

export const MAX_PRICE_KOPECKS = 100_000_000; // 1 000 000 ₽
const priceSchema = z.number().int("Цена должна быть целым числом копеек").min(100, "Минимальная цена — 1 ₽").max(MAX_PRICE_KOPECKS, "Максимальная цена — 1 000 000 ₽");

export const variantFormSchema = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(1, "Укажите название варианта").max(120),
  price: priceSchema,
  oldPrice: priceSchema.nullish(),
  isActive: z.boolean().default(true),
});

export const productFormSchema = z
  .object({
    title: z.string().trim().min(3, "Название — минимум 3 символа").max(160, "Название — максимум 160 символов"),
    categoryId: idSchema,
    type: z.enum(PRODUCT_TYPES),
    deliveryMode: z.enum(SELLER_DELIVERY_MODES),
    platform: z.enum(PLATFORMS.map((p) => p.value) as [string, ...string[]]).nullish(),
    region: z.enum(REGIONS.map((r) => r.value) as [string, ...string[]]).nullish(),
    shortDescription: z.string().trim().max(240, "Краткое описание — максимум 240 символов").nullish(),
    description: z.string().trim().min(30, "Описание — минимум 30 символов").max(10_000),
    /** activation steps, one per line */
    instructions: z.string().trim().max(4000).default(""),
    images: z.array(imageUrlSchema).max(10, "Не больше 10 изображений").default([]),
    tags: z.array(z.string().trim().min(1).max(40)).max(15, "Не больше 15 тегов").default([]),
    price: priceSchema,
    oldPrice: priceSchema.nullish(),
    variants: z.array(variantFormSchema).max(30, "Не больше 30 вариантов").default([]),
    intent: z.enum(["draft", "submit"]),
  })
  .superRefine((v, ctx) => {
    if (v.type === "TOPUP" && v.platform === "STEAM") ctx.addIssue({ code: "custom", path: ["type"], message: "Пополнение Steam выполняет сама площадка — выберите другой тип товара" });
    if (v.variants.length > 0 && !v.variants.some((x) => x.isActive)) ctx.addIssue({ code: "custom", path: ["variants"], message: "Должен быть хотя бы один активный вариант" });
    if (v.oldPrice != null && v.variants.length === 0 && v.oldPrice <= v.price) ctx.addIssue({ code: "custom", path: ["oldPrice"], message: "Старая цена должна быть больше текущей" });
    for (const [i, x] of v.variants.entries()) {
      if (x.oldPrice != null && x.oldPrice <= x.price) ctx.addIssue({ code: "custom", path: ["variants", i, "oldPrice"], message: "Старая цена варианта должна быть больше текущей" });
    }
  });

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormData = z.output<typeof productFormSchema>;
