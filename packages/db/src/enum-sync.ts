/**
 * Compile-time guard: enum lists in @asap/shared must mirror the Prisma enums.
 * If this file fails typecheck, update packages/shared/src/constants.ts.
 */
import type * as P from "./generated/enums";
import * as S from "@asap/shared";

type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const ok = <T extends true>(_?: T) => undefined;

ok<Eq<(typeof S.ROLES)[number], P.Role>>();
ok<Eq<(typeof S.PRODUCT_TYPES)[number], P.ProductType>>();
ok<Eq<(typeof S.DELIVERY_MODES)[number], P.DeliveryMode>>();
ok<Eq<(typeof S.PRODUCT_STATUSES)[number], P.ProductStatus>>();
ok<Eq<(typeof S.STOCK_STATUSES)[number], P.StockStatus>>();
ok<Eq<(typeof S.ORDER_STATUSES)[number], P.OrderStatus>>();
ok<Eq<(typeof S.PAYMENT_PROVIDERS)[number], P.PaymentProvider>>();
ok<Eq<(typeof S.PAYOUT_STATUSES)[number], P.PayoutStatus>>();
ok<Eq<(typeof S.DISPUTE_STATUSES)[number], P.DisputeStatus>>();
ok<Eq<(typeof S.REVIEW_STATUSES)[number], P.ReviewStatus>>();
ok<Eq<(typeof S.SELLER_STATUSES)[number], P.SellerStatus>>();
ok<Eq<(typeof S.LEDGER_ACCOUNTS)[number], P.LedgerAccountType>>();
ok<Eq<(typeof S.LEDGER_KINDS)[number], P.LedgerKind>>();
