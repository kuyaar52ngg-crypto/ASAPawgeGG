import { ORDER_TRANSITIONS, type OrderStatusName } from "@asap/shared";

/** Statuses in which the buyer has paid (money is in the system). */
export const PAID_STATUSES: readonly OrderStatusName[] = ["PAID", "PROCESSING", "DELIVERED", "DISPUTED", "REFUNDED"];
/** Terminal statuses: nothing can change anymore. */
export const TERMINAL_STATUSES: readonly OrderStatusName[] = ["REFUNDED", "CANCELLED"];

export class OrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatusName,
    public readonly to: OrderStatusName,
  ) {
    super(`Недопустимый переход статуса заказа: ${from} -> ${to}`);
    this.name = "OrderTransitionError";
  }
}

export function canTransition(from: OrderStatusName, to: OrderStatusName): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatusName, to: OrderStatusName): void {
  if (!canTransition(from, to)) throw new OrderTransitionError(from, to);
}

export function isTerminal(status: OrderStatusName): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/** Statuses from which an order can still be refunded (per transition table). */
export function isRefundable(status: OrderStatusName): boolean {
  return canTransition(status, "REFUNDED");
}

/**
 * Order status derived from the statuses of its items after a delivery step.
 * Returns null when the order should stay as is.
 */
export function deriveOrderStatus(current: OrderStatusName, itemStatuses: readonly string[]): OrderStatusName | null {
  if (itemStatuses.length === 0) return null;
  const live = itemStatuses.filter((s) => s !== "REFUNDED");
  if (live.length === 0) return current === "REFUNDED" ? null : "REFUNDED";
  let next: OrderStatusName;
  if (live.every((s) => s === "DELIVERED")) next = "DELIVERED";
  else if (live.some((s) => s === "FAILED") && live.every((s) => s === "FAILED" || s === "DELIVERED")) next = "FAILED";
  else if (live.some((s) => s === "PROCESSING" || s === "DELIVERED")) next = "PROCESSING";
  else next = current;
  if (next === current) return null;
  return canTransition(current, next) ? next : null;
}
