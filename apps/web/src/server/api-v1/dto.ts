import { ORDER_STATUS_LABELS, type OrderStatusName } from "@asap/shared";
import type { ProductCardData } from "@/server/catalog/types";

/** Public JSON shapes of REST API v1. Money is ALWAYS integer kopecks (+ `currency: "RUB"`). */

export const CURRENCY = "RUB" as const;

export function productCardDto(p: ProductCardData, baseUrl: string) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    price: p.price,
    oldPrice: p.oldPrice,
    currency: CURRENCY,
    platform: p.platform,
    region: p.region,
    type: p.type,
    deliveryMode: p.deliveryMode,
    rating: p.ratingAvg,
    ratingCount: p.ratingCount,
    salesCount: p.salesCount,
    hasVariants: p.hasVariants,
    inStock: p.inStock,
    image: p.coverImage,
    seller: { name: p.sellerName, slug: p.sellerSlug },
    url: `${baseUrl}/product/${p.slug}`,
  };
}

export interface OrderRow {
  id: string;
  number: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  createdAt: Date;
  paidAt: Date | null;
  deliveredAt: Date | null;
  items: {
    id: string;
    productId: string;
    title: string;
    variantTitle: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
    status: string;
  }[];
}

export interface DeliveryInfo {
  orderItemId: string;
  secrets: string[];
  deliveryData: Record<string, unknown> | null;
}

/** `delivery` (decrypted content) is passed ONLY by single-order endpoints for the buyer's own order. */
export function orderDto(o: OrderRow, delivery?: DeliveryInfo[] | null) {
  const byItem = new Map((delivery ?? []).map((d) => [d.orderItemId, d]));
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    statusLabel: ORDER_STATUS_LABELS[o.status as OrderStatusName] ?? o.status,
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    currency: CURRENCY,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    items: o.items.map((i) => {
      const d = byItem.get(i.id);
      return {
        id: i.id,
        productId: i.productId,
        title: i.title,
        variantTitle: i.variantTitle,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        status: i.status,
        ...(delivery ? { delivery: { secrets: d?.secrets ?? [], data: d?.deliveryData ?? null } } : {}),
      };
    }),
  };
}

export const orderSelect = {
  id: true,
  number: true,
  status: true,
  subtotal: true,
  discount: true,
  total: true,
  createdAt: true,
  paidAt: true,
  deliveredAt: true,
  items: { orderBy: { createdAt: "asc" as const }, select: { id: true, productId: true, title: true, variantTitle: true, quantity: true, unitPrice: true, total: true, status: true } },
} as const;
