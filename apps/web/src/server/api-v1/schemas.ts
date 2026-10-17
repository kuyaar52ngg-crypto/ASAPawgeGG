import { z } from "zod";
import { idSchema } from "@asap/shared";
import { itemMetaSchema } from "@/server/cart/meta";

/** Request schemas of REST API v1 (also reused to document the API in OpenAPI). */

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: idSchema,
        variantId: idSchema.nullish(),
        quantity: z.number().int().min(1).max(50).default(1),
        /** Steam login (TOPUP), custom Steam amount in kopecks, or free-form delivery data (MANUAL products) */
        steamLogin: itemMetaSchema.shape.steamLogin,
        amountKopecks: itemMetaSchema.shape.amountKopecks,
        buyerInput: itemMetaSchema.shape.buyerInput,
      }),
    )
    .min(1, "Добавьте хотя бы одну позицию")
    .max(20, "Не больше 20 позиций в заказе"),
  promoCode: z.string().trim().max(40).optional(),
});
export type CreateOrderBody = z.infer<typeof createOrderSchema>;

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["PENDING", "PAID", "PROCESSING", "DELIVERED", "DISPUTED", "REFUNDED", "CANCELLED", "FAILED"]).optional(),
});

export const stockUploadBodySchema = z.object({
  items: z.array(z.string()).min(1).max(5000),
  variantId: idSchema.nullish(),
});

export const moderateBodySchema = z.object({
  decision: z.enum(["approve", "reject", "archive"]),
  reason: z.string().trim().max(500).optional(),
});

export const daysQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const adminMetricsQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "days: 7, 30 или 90").default(30),
  summary: z.enum(["0", "1", "true", "false"]).optional(),
});
