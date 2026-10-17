import "server-only";
import { prisma } from "@asap/db";
import { decryptStock } from "@asap/shared";

export interface DeliveredItem {
  orderItemId: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  status: string;
  /** decrypted keys / credentials — NEVER log or put into list endpoints */
  secrets: string[];
  /** provider/manual result (no secrets), e.g. { message } or { txId } */
  deliveryData: Record<string, unknown> | null;
}

/**
 * Decrypt delivered stock for the BUYER of a paid order (CONTRACTS §7). Server-side only.
 * Returns null when the order does not exist or does not belong to `buyerId`.
 * Secrets are returned only for items that are DELIVERED and whose stock is SOLD.
 */
export async function getOrderDelivery(orderId: string, buyerId: string): Promise<DeliveredItem[] | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId },
    select: {
      status: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, title: true, variantTitle: true, quantity: true, status: true, deliveryData: true,
          stockItems: { where: { status: "SOLD" }, orderBy: { createdAt: "asc" }, select: { payloadEnc: true } },
        },
      },
    },
  });
  if (!order) return null;
  const released = !["PENDING", "CANCELLED"].includes(order.status);
  return order.items.map((it) => {
    let secrets: string[] = [];
    if (released && it.status === "DELIVERED") {
      secrets = it.stockItems.flatMap((s) => {
        try {
          return [decryptStock(s.payloadEnc)];
        } catch {
          return ["[ошибка расшифровки — обратитесь в поддержку]"];
        }
      });
    }
    return {
      orderItemId: it.id,
      title: it.title,
      variantTitle: it.variantTitle,
      quantity: it.quantity,
      status: it.status,
      secrets,
      deliveryData: it.deliveryData && typeof it.deliveryData === "object" ? (it.deliveryData as Record<string, unknown>) : null,
    };
  });
}
