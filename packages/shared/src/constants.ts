/**
 * Shared constants. Enum value lists MIRROR packages/db/prisma/schema.prisma
 * (packages/db/src/enum-sync.ts fails typecheck if they diverge).
 */

export const ROLES = ["USER", "SELLER", "ADMIN"] as const;
export type RoleName = (typeof ROLES)[number];

export const PRODUCT_TYPES = ["KEY", "ACCOUNT", "SUBSCRIPTION", "TOPUP", "GIFT_CARD", "CURRENCY", "SERVICE"] as const;
export type ProductTypeName = (typeof PRODUCT_TYPES)[number];
export const PRODUCT_TYPE_LABELS: Record<ProductTypeName, string> = {
  KEY: "Ключ",
  ACCOUNT: "Аккаунт",
  SUBSCRIPTION: "Подписка",
  TOPUP: "Пополнение",
  GIFT_CARD: "Подарочная карта",
  CURRENCY: "Внутриигровая валюта",
  SERVICE: "Услуга",
};

export const DELIVERY_MODES = ["AUTO_STOCK", "AUTO_PROVIDER", "MANUAL"] as const;
export type DeliveryModeName = (typeof DELIVERY_MODES)[number];
export const DELIVERY_MODE_LABELS: Record<DeliveryModeName, string> = {
  AUTO_STOCK: "Мгновенная выдача",
  AUTO_PROVIDER: "Автоматически (поставщик)",
  MANUAL: "Вручную продавцом",
};

export const PRODUCT_STATUSES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "REJECTED", "ARCHIVED"] as const;
export type ProductStatusName = (typeof PRODUCT_STATUSES)[number];
export const PRODUCT_STATUS_LABELS: Record<ProductStatusName, string> = {
  DRAFT: "Черновик",
  PENDING_REVIEW: "На модерации",
  ACTIVE: "Активен",
  REJECTED: "Отклонён",
  ARCHIVED: "В архиве",
};

export const STOCK_STATUSES = ["AVAILABLE", "RESERVED", "SOLD"] as const;

export const ORDER_STATUSES = ["PENDING", "PAID", "PROCESSING", "DELIVERED", "DISPUTED", "REFUNDED", "CANCELLED", "FAILED"] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatusName, string> = {
  PENDING: "Ожидает оплаты",
  PAID: "Оплачен",
  PROCESSING: "Выдаётся",
  DELIVERED: "Выдан",
  DISPUTED: "Спор",
  REFUNDED: "Возврат",
  CANCELLED: "Отменён",
  FAILED: "Ошибка",
};

/** Allowed order status transitions (state machine). Enforce in server/orders. */
export const ORDER_TRANSITIONS: Record<OrderStatusName, readonly OrderStatusName[]> = {
  PENDING: ["PAID", "CANCELLED", "FAILED"],
  PAID: ["PROCESSING", "DELIVERED", "REFUNDED", "FAILED"],
  PROCESSING: ["DELIVERED", "FAILED", "REFUNDED"],
  DELIVERED: ["DISPUTED", "REFUNDED"],
  DISPUTED: ["DELIVERED", "REFUNDED"],
  REFUNDED: [],
  CANCELLED: [],
  FAILED: ["REFUNDED", "PROCESSING"],
};

export const PAYMENT_PROVIDERS = ["PLATEGA", "ROLLYPAY", "BALANCE", "SANDBOX"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const PAYOUT_STATUSES = ["REQUESTED", "APPROVED", "PAID", "REJECTED", "CANCELLED"] as const;
export const DISPUTE_STATUSES = ["OPEN", "SELLER_REPLIED", "ESCALATED", "RESOLVED_REFUND", "RESOLVED_REJECTED", "CLOSED"] as const;
export const REVIEW_STATUSES = ["PENDING", "PUBLISHED", "HIDDEN"] as const;
export const SELLER_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"] as const;

export const LEDGER_ACCOUNTS = ["USER_BALANCE", "SELLER_HOLD", "SELLER_AVAILABLE", "PLATFORM_FEE", "EXTERNAL"] as const;
export const LEDGER_KINDS = ["TOPUP", "PURCHASE", "HOLD_RELEASE", "PAYOUT", "PAYOUT_REVERSAL", "REFUND", "ADJUSTMENT"] as const;

// ───────────── Catalog dictionaries ─────────────
export const PLATFORMS = [
  { value: "STEAM", label: "Steam" },
  { value: "XBOX", label: "Xbox" },
  { value: "PLAYSTATION", label: "PlayStation" },
  { value: "NINTENDO", label: "Nintendo" },
  { value: "EPIC", label: "Epic Games" },
  { value: "EA", label: "EA App" },
  { value: "UBISOFT", label: "Ubisoft Connect" },
  { value: "BATTLENET", label: "Battle.net" },
  { value: "PC", label: "PC" },
  { value: "MOBILE", label: "Mobile" },
  { value: "OTHER", label: "Другое" },
] as const;

export const REGIONS = [
  { value: "GLOBAL", label: "Весь мир" },
  { value: "RU", label: "Россия" },
  { value: "CIS", label: "СНГ" },
  { value: "EU", label: "Европа" },
  { value: "TR", label: "Турция" },
  { value: "AR", label: "Аргентина" },
  { value: "US", label: "США" },
  { value: "KZ", label: "Казахстан" },
] as const;

export const SORT_OPTIONS = [
  { value: "popular", label: "Популярные" },
  { value: "new", label: "Новинки" },
  { value: "price_asc", label: "Дешевле" },
  { value: "price_desc", label: "Дороже" },
  { value: "rating", label: "По рейтингу" },
  { value: "discount", label: "По скидке" },
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number]["value"];

// ───────────── Business defaults ─────────────
export const DEFAULT_COMMISSION_BPS = 1000; // 10%
export const DEFAULT_HOLD_DAYS = 3;
export const MIN_PAYOUT_KOPECKS = 100_000; // 1 000 ₽
export const STOCK_RESERVATION_MINUTES = 30; // matches the 30 min unpaid-order expiry (CONTRACTS §20-B)
export const STEAM_TOPUP_MIN_KOPECKS = 10_000; // 100 ₽
export const STEAM_TOPUP_MAX_KOPECKS = 1_500_000; // 15 000 ₽
export const STEAM_TOPUP_FEE_BPS = 500; // 5% service fee shown in calculator

/** Settings keys stored in the `Setting` table (JSON values). */
export const SETTING_KEYS = {
  commissionDefaultBps: "commission.defaultBps",
  holdDays: "commission.holdDays",
  aiProvider: "ai.provider",
  aiModel: "ai.model",
  aiAutoPublish: "ai.autoPublishThreshold",
  paymentsEnabled: "payments.enabled",
  ymId: "analytics.ymId",
  maintenance: "site.maintenance",
  supportContacts: "site.supportContacts",
  /** Steam top-up service fee in percent (number, e.g. 4). Falls back to STEAM_TOPUP_FEE_BPS. Zone A. */
  steamTopupFeePercent: "steam_topup_fee_percent",
} as const;

// ───────────── Web <-> worker contract ─────────────
export const JOB_NAMES = [
  "fulfill_order",
  "release_holds",
  "ai_moderate_product",
  "ai_moderate_review",
  "ai_score_fraud",
  "aggregate_daily_metrics",
  "expire_reservations",
  "expire_pending_orders",
  "send_notification",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

// ───────────── Analytics ─────────────
export const ANALYTICS_EVENTS = [
  "page_view",
  "view_item",
  "search",
  "add_to_cart",
  "remove_from_cart",
  "begin_checkout",
  "add_payment_info",
  "purchase",
  "sign_up",
  "login",
  "topup_balance",
  "steam_topup_start",
  "favorite_add",
  "review_submit",
  "dispute_open",
  "ai_chat_message",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

// ───────────── API ─────────────
export const API_SCOPES = [
  "catalog:read",
  "orders:read",
  "orders:create",
  "seller:products",
  "seller:stock",
  "seller:stats",
  "admin:metrics",
  "admin:moderate",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Scopes each role may grant to its API keys. */
export const ROLE_SCOPES: Record<RoleName, readonly ApiScope[]> = {
  USER: ["catalog:read", "orders:read", "orders:create"],
  SELLER: ["catalog:read", "orders:read", "orders:create", "seller:products", "seller:stock", "seller:stats"],
  ADMIN: API_SCOPES,
};

export const APP_NAME = "ASAPawge GG";
