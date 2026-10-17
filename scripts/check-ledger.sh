#!/usr/bin/env bash
# Ledger integrity: (1) every txId balances (Σ DEBIT = Σ CREDIT); (2) cached balances equal the ledger.
# Prints the number of violations (all must be 0). Usage: bash scripts/check-ledger.sh [DATABASE_URL]
DB="${1:-${DATABASE_URL:-postgresql://asap:asap@localhost:5432/asapawge}}"
q() { psql "$DB" -At -c "$1"; }
echo "unbalanced transactions : $(q "select count(*) from (select \"txId\" from \"LedgerEntry\" group by \"txId\" having sum(case when direction='DEBIT' then amount else -amount end)<>0) x")"
echo "User.balance mismatches : $(q "select count(*) from \"User\" u where u.balance <> coalesce((select sum(case when direction='CREDIT' then amount else -amount end) from \"LedgerEntry\" l where l.account='USER_BALANCE' and l.\"ownerId\"=u.id),0)")"
echo "seller hold mismatches  : $(q "select count(*) from \"SellerProfile\" s where s.\"holdBalance\" <> coalesce((select sum(case when direction='CREDIT' then amount else -amount end) from \"LedgerEntry\" l where l.account='SELLER_HOLD' and l.\"ownerId\"=s.\"userId\"),0)")"
echo "seller avail mismatches : $(q "select count(*) from \"SellerProfile\" s where s.\"availableBalance\" <> coalesce((select sum(case when direction='CREDIT' then amount else -amount end) from \"LedgerEntry\" l where l.account='SELLER_AVAILABLE' and l.\"ownerId\"=s.\"userId\"),0)")"
