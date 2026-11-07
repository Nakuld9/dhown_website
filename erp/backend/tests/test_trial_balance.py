"""Full accounting cycle -> trial balance always balances (TEST 15/16)."""
from __future__ import annotations

from decimal import Decimal

from app.services.accounting import trial_balance as tb
from tests.helpers import L, post


def _run_full_cycle(db, company_id):
    post(db, company_id, [L("1020", debit="500000"), L("3010", credit="500000")],
         vtype="RV", ref="CAP:intro")
    post(db, company_id,
         [L("1100", debit="100000"), L("1121", debit="9000"), L("1122", debit="9000"),
          L("2010", credit="118000")], vtype="PI", ref="PI:chem")
    post(db, company_id, [L("2010", debit="118000"), L("1020", credit="118000")],
         vtype="PV", ref="PV:supplier")
    post(db, company_id, [L("1080", debit="40000"), L("1100", credit="40000")],
         vtype="PJ", ref="WIP:consume")
    post(db, company_id, [L("1085", debit="40000"), L("1080", credit="40000")],
         vtype="SJ", ref="FG:transfer")
    post(db, company_id,
         [L("1040", debit="236000"), L("4010", credit="200000"),
          L("2041", credit="18000"), L("2042", credit="18000")], vtype="SI", ref="SI:inv")
    post(db, company_id, [L("5150", debit="40000"), L("1085", credit="40000")],
         vtype="SJ", ref="COGS:inv")
    post(db, company_id, [L("1020", debit="236000"), L("1040", credit="236000")],
         vtype="RV", ref="RV:receipt")


def test_trial_balance_balances_after_full_cycle(db, company):
    _run_full_cycle(db, company.id)
    report = tb.trial_balance(db, company.id)

    assert report["is_balanced"] is True
    assert report["totals"]["closing_debit"] == report["totals"]["closing_credit"]
    assert report["totals"]["closing_debit"] == Decimal("736000.00")

    balances = {r["account_code"]: r for r in report["rows"]}
    assert balances["1020"]["closing_debit"] == Decimal("618000.00")   # Bank
    assert balances["3010"]["closing_credit"] == Decimal("500000.00")  # Owner's Capital
    assert balances["1100"]["closing_debit"] == Decimal("60000.00")    # Chemical Inventory
    assert balances["4010"]["closing_credit"] == Decimal("200000.00")  # Fabric Sales
    assert balances["5150"]["closing_debit"] == Decimal("40000.00")    # COGS

    # Fully-settled control accounts had movement but net to zero; a trial
    # balance still lists them, with equal (zero) closing debit and credit.
    for netted in ("1040", "1080", "1085", "2010"):
        assert netted in balances
        assert balances[netted]["closing_debit"] == balances[netted]["closing_credit"] == Decimal("0.00")


def test_account_ledger_drilldown(db, company):
    _run_full_cycle(db, company.id)
    ledger = tb.account_ledger(db, company.id, "1020")  # Bank
    assert ledger["closing_balance"] == Decimal("618000.00")
    # capital in, supplier payment out, customer receipt in
    assert len(ledger["entries"]) == 3
    assert ledger["entries"][-1]["running_balance"] == Decimal("618000.00")


def test_inventory_control_reconciles_with_gl(db, company):
    """Acceptance TEST 17 (foundation): the chemical-inventory GL balance equals
    the net of its own postings. A full perpetual inventory sub-ledger arrives
    in Stage 5; here we assert the control-account balance is self-consistent."""
    _run_full_cycle(db, company.id)
    ledger = tb.account_ledger(db, company.id, "1100")
    net = sum((e["debit"] - e["credit"] for e in ledger["entries"]), Decimal("0"))
    assert net == ledger["closing_balance"] == Decimal("60000.00")
