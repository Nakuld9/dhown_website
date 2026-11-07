"""The worked accounting examples from spec 13B become executable tests.

Intra-state (Punjab -> Punjab) GST is split CGST+SGST; the spec's single
"Input GST 18000" becomes 9000 + 9000. Every voucher must balance.
"""
from __future__ import annotations

from decimal import Decimal

from app.models.accounting import VoucherStatus
from tests.helpers import L, post


def _assert_balanced(v):
    assert v.status == VoucherStatus.POSTED
    assert v.total_debit == v.total_credit
    d = sum((ln.debit for ln in v.lines), Decimal("0"))
    c = sum((ln.credit for ln in v.lines), Decimal("0"))
    assert d == c == v.total_debit


def test_example1_chemical_purchase_on_credit(db, company):
    v = post(
        db, company.id,
        [
            L("1100", debit="100000", narration="Chemical inventory"),
            L("1121", debit="9000", narration="Input CGST"),
            L("1122", debit="9000", narration="Input SGST"),
            L("2010", credit="118000", narration="Supplier payable"),
        ],
        vtype="PI", ref="PI:CHEM-0001",
    )
    _assert_balanced(v)
    assert v.total_debit == Decimal("118000.00")


def test_example2_chemical_consumption_in_dyebath(db, company):
    v = post(
        db, company.id,
        [L("1080", debit="12000", narration="Dyeing WIP - chemical cost"),
         L("1100", credit="12000", narration="Chemical inventory")],
        vtype="PJ", ref="BATH:DY-26001-B01:consume",
    )
    _assert_balanced(v)


def test_example3_electricity_bill(db, company):
    v = post(
        db, company.id,
        [L("5070", debit="50000"), L("1121", debit="4500"), L("1122", debit="4500"),
         L("2020", credit="59000")],
        vtype="PI", ref="PI:ELEC-2026-11",
    )
    _assert_balanced(v)


def test_example4_customer_sales_with_gst(db, company):
    """Acceptance TEST 13: sales invoice with correct receivable + tax postings."""
    v = post(
        db, company.id,
        [L("1040", debit="236000", narration="Customer receivable"),
         L("4010", credit="200000", narration="Fabric sales"),
         L("2041", credit="18000", narration="Output CGST"),
         L("2042", credit="18000", narration="Output SGST")],
        vtype="SI", ref="SI:INV-0001",
    )
    _assert_balanced(v)


def test_example5_customer_receipt(db, company):
    v = post(
        db, company.id,
        [L("1020", debit="236000"), L("1040", credit="236000")],
        vtype="RV", ref="RV:RCPT-0001",
    )
    _assert_balanced(v)


def test_example6_supplier_payment(db, company):
    v = post(
        db, company.id,
        [L("2010", debit="118000"), L("1020", credit="118000")],
        vtype="PV", ref="PV:PAY-0001",
    )
    _assert_balanced(v)


def test_example7_wip_to_finished_goods(db, company):
    """Acceptance TEST 12: transfer production cost WIP -> FG."""
    v = post(
        db, company.id,
        [L("1085", debit="75000"), L("1080", credit="75000")],
        vtype="SJ", ref="FG:DY-26001:transfer",
    )
    _assert_balanced(v)


def test_example8_cost_of_goods_sold(db, company):
    v = post(
        db, company.id,
        [L("5150", debit="140000"), L("1085", credit="140000")],
        vtype="SJ", ref="COGS:INV-0001",
    )
    _assert_balanced(v)


def test_example9_bank_charges(db, company):
    v = post(
        db, company.id,
        [L("6100", debit="1000"), L("1020", credit="1000")],
        vtype="PV", ref="PV:BANKCHG-0001",
    )
    _assert_balanced(v)


def test_correction_dosing_creates_separate_transaction(db, company):
    """Acceptance TEST 10: a 200 g dye correction posts a NEW consumption
    voucher; the original dispensing posting is never overwritten."""
    original = post(
        db, company.id,
        [L("1080", debit="3500", narration="Reactive Blue 3.50 kg"),
         L("1090", credit="3500")],
        vtype="PJ", ref="BATH:DY-26001-B01:dye:main",
    )
    # 200 g correction at the same unit cost -> its own posting reference.
    correction = post(
        db, company.id,
        [L("1080", debit="200", narration="Correction: Reactive Blue +0.20 kg"),
         L("1090", credit="200")],
        vtype="PJ", ref="BATH:DY-26001-B01:dye:correction-1",
    )
    assert original.id != correction.id
    assert original.status == VoucherStatus.POSTED  # untouched
    _assert_balanced(correction)
