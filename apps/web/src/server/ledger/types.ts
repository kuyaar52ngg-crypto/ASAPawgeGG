/** Ledger enums as string unions (mirror packages/db schema; kept dependency-free so pure code stays testable). */
export type LedgerAccountName = "USER_BALANCE" | "SELLER_HOLD" | "SELLER_AVAILABLE" | "PLATFORM_FEE" | "EXTERNAL";
export type LedgerDirectionName = "DEBIT" | "CREDIT";
export type LedgerKindName = "TOPUP" | "PURCHASE" | "HOLD_RELEASE" | "PAYOUT" | "PAYOUT_REVERSAL" | "REFUND" | "ADJUSTMENT";
