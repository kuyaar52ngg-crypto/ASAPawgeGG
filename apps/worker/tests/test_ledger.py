import pytest
from sqlalchemy import text

from app.ledger import (
    InsufficientFundsError,
    Line,
    LedgerError,
    assert_balanced,
    balance_of,
    cache_deltas,
    hold_release_lines,
    post_ledger,
    purchase_lines,
    refund_lines,
    unbalanced_transactions,
)

from .factories import make_user


def test_every_builder_is_balanced():
    for lines in (
        hold_release_lines("s", 900),
        purchase_lines(buyer_id="b", seller_id="s", total=1000, seller_earning=900, commission_amount=100),
        refund_lines(buyer_id="b", seller_id="s", total=1000, seller_earning=900, commission_amount=100, hold_released=False),
        refund_lines(buyer_id="b", seller_id="s", total=1000, seller_earning=900, commission_amount=100, hold_released=True),
    ):
        assert_balanced(lines)
        debit = sum(line.amount for line in lines if line.direction == "DEBIT")
        credit = sum(line.amount for line in lines if line.direction == "CREDIT")
        assert debit == credit


def test_refund_mirrors_purchase():
    buy = purchase_lines(buyer_id="b", seller_id="s", total=1000, seller_earning=900, commission_amount=100)
    ref = refund_lines(buyer_id="b", seller_id="s", total=1000, seller_earning=900, commission_amount=100, hold_released=False)
    d1, d2 = cache_deltas(buy), cache_deltas(ref)
    assert d1.user_balance == {"b": -1000} and d2.user_balance == {"b": 1000}
    assert d1.seller_hold == {"s": 900} and d2.seller_hold == {"s": -900}
    assert balance_of([l for l in buy + ref if l.account == "PLATFORM_FEE"]) == 0


def test_rejects_unbalanced_zero_and_owner_errors():
    with pytest.raises(LedgerError):
        assert_balanced([Line("USER_BALANCE", "DEBIT", 10, "u"), Line("PLATFORM_FEE", "CREDIT", 9)])
    with pytest.raises(LedgerError):
        assert_balanced([Line("USER_BALANCE", "DEBIT", 0, "u"), Line("PLATFORM_FEE", "CREDIT", 0)])
    with pytest.raises(LedgerError):
        assert_balanced([Line("USER_BALANCE", "DEBIT", 10), Line("PLATFORM_FEE", "CREDIT", 10)])  # owned account without owner
    with pytest.raises(LedgerError):
        assert_balanced([Line("EXTERNAL", "DEBIT", 10, "u"), Line("PLATFORM_FEE", "CREDIT", 10)])  # unowned with owner


def test_inconsistent_refund_split_rejected():
    with pytest.raises(LedgerError):
        refund_lines(buyer_id="b", seller_id="s", total=1000, seller_earning=800, commission_amount=100, hold_released=False)


async def test_post_ledger_updates_caches_and_balances(factory):
    async with factory() as s, s.begin():
        seller = await make_user(s, "SELLER")
        buyer = await make_user(s, "USER", balance=0)
        await post_ledger(s, kind="TOPUP", lines=[Line("EXTERNAL", "DEBIT", 5000), Line("USER_BALANCE", "CREDIT", 5000, buyer.id)])
        await post_ledger(s, kind="PURCHASE", lines=purchase_lines(buyer_id=buyer.id, seller_id=seller.id, total=1000, seller_earning=900, commission_amount=100))
        await post_ledger(s, kind="HOLD_RELEASE", lines=hold_release_lines(seller.id, 900))
        assert await unbalanced_transactions(s) == []
        bal = (await s.execute(text('SELECT balance FROM "User" WHERE id = :i'), {"i": buyer.id})).scalar_one()
        sp = (await s.execute(text('SELECT "holdBalance", "availableBalance" FROM "SellerProfile" WHERE "userId" = :i'), {"i": seller.id})).one()
    assert bal == 4000 and tuple(sp) == (0, 900)


async def test_buyer_balance_never_negative(factory):
    async with factory() as s, s.begin():
        buyer = await make_user(s, "USER", balance=0)
        seller = await make_user(s, "SELLER")
        with pytest.raises(InsufficientFundsError):
            await post_ledger(s, kind="PURCHASE", lines=purchase_lines(buyer_id=buyer.id, seller_id=seller.id, total=1000, seller_earning=900, commission_amount=100))
