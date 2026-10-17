import { ORDER_STATUS_LABELS, PRODUCT_STATUS_LABELS, type OrderStatusName, type ProductStatusName } from "@asap/shared";
import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "accent";

const ORDER_VARIANT: Record<OrderStatusName, Variant> = {
  PENDING: "warning",
  PAID: "accent",
  PROCESSING: "accent",
  DELIVERED: "success",
  DISPUTED: "warning",
  REFUNDED: "secondary",
  CANCELLED: "secondary",
  FAILED: "destructive",
};
export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={ORDER_VARIANT[status as OrderStatusName] ?? "outline"}>{ORDER_STATUS_LABELS[status as OrderStatusName] ?? status}</Badge>;
}

const ITEM_LABELS: Record<string, string> = { PENDING: "Ожидает", PROCESSING: "Выдаётся", DELIVERED: "Выдан", FAILED: "Ошибка выдачи", REFUNDED: "Возврат" };
const ITEM_VARIANT: Record<string, Variant> = { PENDING: "warning", PROCESSING: "accent", DELIVERED: "success", FAILED: "destructive", REFUNDED: "secondary" };
export function ItemStatusBadge({ status }: { status: string }) {
  return <Badge variant={ITEM_VARIANT[status] ?? "outline"}>{ITEM_LABELS[status] ?? status}</Badge>;
}

export const DISPUTE_STATUS_LABELS: Record<string, string> = {
  OPEN: "Открыт",
  SELLER_REPLIED: "Продавец ответил",
  ESCALATED: "У администратора",
  RESOLVED_REFUND: "Решён: возврат",
  RESOLVED_REJECTED: "Решён: отклонён",
  CLOSED: "Закрыт",
};
const DISPUTE_VARIANT: Record<string, Variant> = { OPEN: "warning", SELLER_REPLIED: "accent", ESCALATED: "destructive", RESOLVED_REFUND: "success", RESOLVED_REJECTED: "secondary", CLOSED: "secondary" };
export function DisputeStatusBadge({ status }: { status: string }) {
  return <Badge variant={DISPUTE_VARIANT[status] ?? "outline"}>{DISPUTE_STATUS_LABELS[status] ?? status}</Badge>;
}

export const PAYOUT_STATUS_LABELS: Record<string, string> = { REQUESTED: "В обработке", APPROVED: "Одобрена", PAID: "Выплачена", REJECTED: "Отклонена", CANCELLED: "Отменена" };
const PAYOUT_VARIANT: Record<string, Variant> = { REQUESTED: "warning", APPROVED: "accent", PAID: "success", REJECTED: "destructive", CANCELLED: "secondary" };
export function PayoutStatusBadge({ status }: { status: string }) {
  return <Badge variant={PAYOUT_VARIANT[status] ?? "outline"}>{PAYOUT_STATUS_LABELS[status] ?? status}</Badge>;
}

const PRODUCT_VARIANT: Record<ProductStatusName, Variant> = { DRAFT: "secondary", PENDING_REVIEW: "warning", ACTIVE: "success", REJECTED: "destructive", ARCHIVED: "outline" };
export function ProductStatusBadge({ status }: { status: string }) {
  return <Badge variant={PRODUCT_VARIANT[status as ProductStatusName] ?? "outline"}>{PRODUCT_STATUS_LABELS[status as ProductStatusName] ?? status}</Badge>;
}

export const SELLER_STATUS_LABELS: Record<string, string> = { PENDING: "На проверке", VERIFIED: "Подтверждён", REJECTED: "Отклонён", SUSPENDED: "Приостановлен" };

export const LEDGER_KIND_LABELS: Record<string, string> = {
  TOPUP: "Пополнение",
  PURCHASE: "Оплата заказа",
  HOLD_RELEASE: "Разморозка средств",
  PAYOUT: "Выплата",
  PAYOUT_REVERSAL: "Возврат выплаты",
  REFUND: "Возврат за заказ",
  ADJUSTMENT: "Корректировка",
};

export const PAYOUT_METHOD_LABELS: Record<string, string> = { CARD: "Банковская карта", SBP: "СБП", USDT: "USDT", YOOMONEY: "ЮMoney" };

const dtf = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const df = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Moscow" });
const tf = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

/** Moscow-time formatting used throughout the cabinets. Accepts Date or ISO string (client-safe). */
export const formatDateTime = (d: Date | string) => dtf.format(new Date(d));
export const formatDate = (d: Date | string) => df.format(new Date(d));
export const formatTime = (d: Date | string) => tf.format(new Date(d));
