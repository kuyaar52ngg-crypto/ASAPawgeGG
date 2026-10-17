-- Integrity guards found during the adversarial review. Additive only (no data is changed).
-- These are the last line of defence behind the application-level checks: even a bug or a racing writer cannot
--   * refund / charge / release the hold of one OrderItem twice,
--   * store negative or zero money amounts.

-- One PURCHASE, one REFUND and one HOLD_RELEASE posting per order item (the counter-account line identifies the posting).
CREATE UNIQUE INDEX "LedgerEntry_purchase_once_per_item" ON "LedgerEntry" ("orderItemId")
  WHERE "kind" = 'PURCHASE' AND "account" = 'USER_BALANCE' AND "orderItemId" IS NOT NULL;
CREATE UNIQUE INDEX "LedgerEntry_refund_once_per_item" ON "LedgerEntry" ("orderItemId")
  WHERE "kind" = 'REFUND' AND "account" = 'USER_BALANCE' AND "orderItemId" IS NOT NULL;
CREATE UNIQUE INDEX "LedgerEntry_hold_release_once_per_item" ON "LedgerEntry" ("orderItemId")
  WHERE "kind" = 'HOLD_RELEASE' AND "account" = 'SELLER_AVAILABLE' AND "orderItemId" IS NOT NULL;

-- Money can never be negative / zero where that makes no sense.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_money_nonneg" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_money_nonneg" CHECK ("unitPrice" >= 0 AND "total" >= 0 AND "commissionAmount" >= 0 AND "sellerEarning" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_commission_bps_range" CHECK ("commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonneg" CHECK ("price" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_nonneg" CHECK ("price" >= 0);
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_value_pos" CHECK ("value" > 0 AND "usedCount" >= 0);
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_commission_range" CHECK ("commissionBps" IS NULL OR "commissionBps" BETWEEN 0 AND 10000);
