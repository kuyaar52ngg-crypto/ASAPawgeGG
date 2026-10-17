import { ORDER_STATUS_LABELS, PRODUCT_STATUS_LABELS } from "@asap/shared";
import { StatusBadge } from "./common";

type V = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "accent";

export const ROLE_LABELS: Record<string, string> = { USER: "Покупатель", SELLER: "Продавец", ADMIN: "Админ" };
export const ROLE_VARIANTS: Record<string, V> = { USER: "secondary", SELLER: "accent", ADMIN: "default" };

export const SELLER_LABELS: Record<string, string> = { PENDING: "На проверке", VERIFIED: "Подтверждён", REJECTED: "Отклонён", SUSPENDED: "Приостановлен" };
const SELLER_VARIANTS: Record<string, V> = { PENDING: "warning", VERIFIED: "success", REJECTED: "destructive", SUSPENDED: "secondary" };
export const SellerStatusBadge = ({ status }: { status: string }) => <StatusBadge value={status} labels={SELLER_LABELS} variants={SELLER_VARIANTS} />;

const PRODUCT_VARIANTS: Record<string, V> = { DRAFT: "secondary", PENDING_REVIEW: "warning", ACTIVE: "success", REJECTED: "destructive", ARCHIVED: "outline" };
export const ProductStatusBadge = ({ status }: { status: string }) => <StatusBadge value={status} labels={PRODUCT_STATUS_LABELS} variants={PRODUCT_VARIANTS} />;

const ORDER_VARIANTS: Record<string, V> = { PENDING: "warning", PAID: "accent", PROCESSING: "accent", DELIVERED: "success", DISPUTED: "warning", REFUNDED: "secondary", CANCELLED: "secondary", FAILED: "destructive" };
export const OrderStatusBadge = ({ status }: { status: string }) => <StatusBadge value={status} labels={ORDER_STATUS_LABELS} variants={ORDER_VARIANTS} />;

export const ITEM_LABELS: Record<string, string> = { PENDING: "Ожидает", PROCESSING: "Выдаётся", DELIVERED: "Выдан", FAILED: "Ошибка выдачи", REFUNDED: "Возврат" };
const ITEM_VARIANTS: Record<string, V> = { PENDING: "warning", PROCESSING: "accent", DELIVERED: "success", FAILED: "destructive", REFUNDED: "secondary" };
export const ItemStatusBadge = ({ status }: { status: string }) => <StatusBadge value={status} labels={ITEM_LABELS} variants={ITEM_VARIANTS} />;

export const PAYMENT_STATUS_LABELS: Record<string, string> = { CREATED: "Создан", PENDING: "Ожидает", PAID: "Оплачен", FAILED: "Ошибка", CANCELLED: "Отменён", EXPIRED: "Истёк", REFUNDED: "Возврат" };
const PAYMENT_VARIANTS: Record<string, V> = { CREATED: "secondary", PENDING: "warning", PAID: "success", FAILED: "destructive", CANCELLED: "secondary", EXPIRED: "secondary", REFUNDED: "secondary" };
export const PaymentStatusBadge = ({ status }: { status: string }) => <StatusBadge value={status} labels={PAYMENT_STATUS_LABELS} variants={PAYMENT_VARIANTS} />;
export const PROVIDER_LABELS: Record<string, string> = { PLATEGA: "Platega", ROLLYPAY: "RollyPay", BALANCE: "Баланс сайта", SANDBOX: "Тестовая оплата" };

export const DISPUTE_LABELS: Record<string, string> = { OPEN: "Открыт", SELLER_REPLIED: "Продавец ответил", ESCALATED: "У администратора", RESOLVED_REFUND: "Решён: возврат", RESOLVED_REJECTED: "Решён: отказ", CLOSED: "Закрыт" };
const DISPUTE_VARIANTS: Record<string, V> = { OPEN: "warning", SELLER_REPLIED: "accent", ESCALATED: "destructive", RESOLVED_REFUND: "success", RESOLVED_REJECTED: "secondary", CLOSED: "secondary" };
export const DisputeStatusBadge = ({ status }: { status: string }) => <StatusBadge value={status} labels={DISPUTE_LABELS} variants={DISPUTE_VARIANTS} />;

export const PAYOUT_LABELS: Record<string, string> = { REQUESTED: "Запрошена", APPROVED: "Одобрена", PAID: "Выплачена", REJECTED: "Отклонена", CANCELLED: "Отменена" };
const PAYOUT_VARIANTS: Record<string, V> = { REQUESTED: "warning", APPROVED: "accent", PAID: "success", REJECTED: "destructive", CANCELLED: "secondary" };
export const PayoutStatusBadge = ({ status }: { status: string }) => <StatusBadge value={status} labels={PAYOUT_LABELS} variants={PAYOUT_VARIANTS} />;
export const PAYOUT_METHOD_LABELS: Record<string, string> = { CARD: "Банковская карта", SBP: "СБП", USDT: "USDT", YOOMONEY: "ЮMoney" };

export const AI_VERDICT_LABELS: Record<string, string> = { approve: "Одобрить", review: "Проверить вручную", reject: "Отклонить" };
const AI_VERDICT_VARIANTS: Record<string, V> = { approve: "success", review: "warning", reject: "destructive" };
export const AiVerdictBadge = ({ verdict }: { verdict: string }) => <StatusBadge value={verdict} labels={AI_VERDICT_LABELS} variants={AI_VERDICT_VARIANTS} />;

const dtf = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const df = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Moscow" });
/** Moscow-time formatting for admin tables. */
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? dtf.format(new Date(d)) : "—");
export const fmtDate = (d: Date | string | null | undefined) => (d ? df.format(new Date(d)) : "—");
