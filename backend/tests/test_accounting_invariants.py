"""Non-negotiable accounting invariants (spec section 19).

Covers acceptance tests 15 (TB balances), 18 (no duplicate postings) and
19 (posted entries immutable).
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.ledger_guard import ImmutableLedgerError
from app.models.accounting import PeriodStatus, Voucher, VoucherStatus, AccountingPeriod
from app.services.accounting import posting_engine as pe
from tests.helpers import L, VDATE, post


def test_balanced_voucher_posts(db, company):
    v = post(db, company.id, [L("1100", debit="100000"), L("2010", credit="100000")])
    assert v.status == VoucherStatus.POSTED
    assert v.total_debit == Decimal("100000.00")
    assert v.total_credit == Decimal("100000.00")
    assert v.number  # a document number was allocated
    assert len(v.lines) == 2


def test_unbalanced_voucher_rejected(db, company):
    with pytest.raises(pe.UnbalancedVoucherError):
        post(db, company.id, [L("1100", debit="100000"), L("2010", credit="90000")])


def test_zero_voucher_rejected(db, company):
    with pytest.raises(pe.UnbalancedVoucherError):
        post(db, company.id, [L("1100", debit="0"), L("2010", credit="0")])


def test_line_must_be_one_sided(db, company):
    with pytest.raises(pe.UnbalancedVoucherError):
        post(db, company.id, [L("1100", debit="100", credit="100"), L("2010", credit="100")])


def test_group_account_not_postable(db, company):
    # 1000 "Current Assets" is a group header.
    with pytest.raises(pe.AccountNotPostableError):
        post(db, company.id, [L("1000", debit="100"), L("2010", credit="100")])


def test_unknown_account_rejected(db, company):
    with pytest.raises(pe.AccountNotPostableError):
        post(db, company.id, [L("9999", debit="100"), L("2010", credit="100")])


def test_idempotent_posting_reference(db, company):
    """Acceptance TEST 18: the same source event never posts twice."""
    ref = "GRN:CHEM-0001"
    v1 = post(db, company.id, [L("1100", debit="100000"), L("2010", credit="100000")], ref=ref)
    v2 = post(db, company.id, [L("1100", debit="100000"), L("2010", credit="100000")], ref=ref)
    assert v1.id == v2.id
    count = db.execute(
        select(func.count()).select_from(Voucher).where(Voucher.posting_reference == ref)
    ).scalar_one()
    assert count == 1


def test_posted_line_is_immutable(db, company):
    """Acceptance TEST 19: posted journal lines cannot be altered."""
    v = post(db, company.id, [L("1100", debit="100000"), L("2010", credit="100000")])
    line = v.lines[0]
    line.debit = Decimal("1.00")
    with pytest.raises(ImmutableLedgerError):
        db.flush()
    db.rollback()


def test_posted_voucher_cannot_be_deleted(db, company):
    v = post(db, company.id, [L("1100", debit="100000"), L("2010", credit="100000")])
    db.delete(v)
    with pytest.raises(ImmutableLedgerError):
        db.flush()
    db.rollback()


def test_closed_period_blocks_posting(db, company):
    period = db.execute(
        select(AccountingPeriod).where(
            AccountingPeriod.company_id == company.id, AccountingPeriod.code == "2026-11"
        )
    ).scalar_one()
    period.status = PeriodStatus.CLOSED.value
    db.commit()
    with pytest.raises(pe.ClosedPeriodError):
        post(db, company.id, [L("1100", debit="100"), L("2010", credit="100")], vdate=VDATE)


def test_reversal_cancels_original(db, company):
    v = post(db, company.id, [L("1100", debit="100000"), L("2010", credit="100000")])
    reversal = pe.reverse_voucher(db, v.id, reason="data entry error", actor_name="tester")
    db.commit()
    db.refresh(v)
    assert v.status == VoucherStatus.REVERSED
    assert reversal.status == VoucherStatus.REVERSAL
    assert reversal.reversal_of_id == v.id
    # Amounts are swapped.
    assert reversal.total_debit == v.total_credit
    assert {(l.debit, l.credit) for l in reversal.lines} == {
        (Decimal("0.00"), Decimal("100000.00")),
        (Decimal("100000.00"), Decimal("0.00")),
    }
