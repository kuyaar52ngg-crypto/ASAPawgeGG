import { z } from "zod";
import {
  DELIVERY_MODES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  SORT_OPTIONS,
  API_SCOPES,
  STEAM_TOPUP_MAX_KOPECKS,
  STEAM_TOPUP_MIN_KOPECKS,
  ANALYTICS_EVENTS,
} from "./constants";

// ───────────── primitives ─────────────
export const idSchema = z.string().min(1).max(64);
export const kopecksSchema = z.number().int().nonnegative().max(2_000_000_000);
export const slugSchema = z.string().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Только латиница, цифры и дефисы");
export const emailSchema = z.string().trim().toLowerCase().email("Некорректный email").max(254);
export const passwordSchema = z
  .string()
  .min(8, "Минимум 8 символов")
  .max(128)
  .regex(/[A-Za-z]/, "Нужна хотя бы одна буква")
  .regex(/\d/, "Нужна хотя бы одна цифра");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type Pagination = z.infer<typeof paginationSchema>;

// ───────────── auth ─────────────
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(60),
  email: emailSchema,
  password: passwordSchema,
  asSeller: z.boolean().optional().default(false),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

// ───────────── catalog ─────────────
export const catalogQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(120).optional(),
  platform: z.string().max(40).optional(),
  region: z.string().max(40).optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  sellerId: idSchema.optional(),
  minPrice: kopecksSchema.optional(),
  maxPrice: kopecksSchema.optional(),
  inStock: z.coerce.boolean().optional(),
  sort: z.enum(SORT_OPTIONS.map((s) => s.value) as [string, ...string[]]).default("popular"),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const variantInputSchema = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(1).max(120),
  price: kopecksSchema.min(100),
  oldPrice: kopecksSchema.nullish(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  attributes: z.record(z.string(), z.unknown()).nullish(),
  providerSku: z.string().max(120).nullish(),
});

export const productInputSchema = z.object({
  title: z.string().trim().min(3, "Минимум 3 символа").max(160),
  categoryId: idSchema,
  type: z.enum(PRODUCT_TYPES),
  deliveryMode: z.enum(DELIVERY_MODES).default("AUTO_STOCK"),
  shortDescription: z.string().trim().max(240).nullish(),
  description: z.string().trim().min(10, "Опишите товар подробнее").max(10_000),
  price: kopecksSchema.min(100),
  oldPrice: kopecksSchema.nullish(),
  platform: z.string().max(40).nullish(),
  region: z.string().max(40).nullish(),
  coverImage: z.string().url().nullish(),
  images: z.array(z.string().url()).max(10).default([]),
  tags: z.array(z.string().trim().max(40)).max(15).default([]),
  variants: z.array(variantInputSchema).max(30).default([]),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productStatusSchema = z.enum(PRODUCT_STATUSES);

export const stockUploadSchema = z.object({
  productId: idSchema,
  variantId: idSchema.nullish(),
  /** One item per entry (already split by lines / CSV rows). */
  items: z.array(z.string().trim().min(1).max(4000)).min(1).max(5000),
});

// ───────────── cart / checkout ─────────────
export const cartAddSchema = z.object({
  productId: idSchema,
  variantId: idSchema.nullish(),
  quantity: z.number().int().min(1).max(50).default(1),
  meta: z.record(z.string(), z.unknown()).nullish(),
});

export const checkoutSchema = z.object({
  email: emailSchema,
  paymentMethod: z.enum(["BALANCE", "PLATEGA", "ROLLYPAY", "SANDBOX"]),
  promoCode: z.string().trim().toUpperCase().max(40).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const steamTopupSchema = z.object({
  steamLogin: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/, "Некорректный логин Steam"),
  amount: kopecksSchema.min(STEAM_TOPUP_MIN_KOPECKS).max(STEAM_TOPUP_MAX_KOPECKS),
  email: emailSchema,
});
export type SteamTopupInput = z.infer<typeof steamTopupSchema>;

// ───────────── social ─────────────
export const reviewInputSchema = z.object({
  orderItemId: idSchema,
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000).optional(),
});
export const disputeInputSchema = z.object({
  orderItemId: idSchema,
  reason: z.string().trim().min(10, "Опишите проблему подробнее").max(2000),
});
export const disputeMessageSchema = z.object({
  disputeId: idSchema,
  body: z.string().trim().min(1).max(4000),
});
export const payoutRequestSchema = z.object({
  amount: kopecksSchema.min(1),
  method: z.enum(["CARD", "SBP", "USDT", "YOOMONEY"]),
  details: z.record(z.string(), z.string().max(200)),
});

// ───────────── platform ─────────────
export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const analyticsEventSchema = z.object({
  name: z.enum(ANALYTICS_EVENTS),
  path: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  sessionId: z.string().max(64).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

// ───────────── web <-> worker ─────────────
export const fulfillOrderJobSchema = z.object({ orderId: idSchema });
export const moderateProductJobSchema = z.object({ productId: idSchema });
