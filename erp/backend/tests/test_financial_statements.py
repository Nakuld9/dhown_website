"""Stage 7: Profit & Loss, Balance Sheet, Cash Flow, and ageing (brief §13G)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services.accounting import financial_statements as fs
from tests.helpers import L, post

FY_START = date(2026, 4, 1)
AS_OF = date(2026, 11, 7)


def _scenario(db, company_id):
    # 1) Capital introduced (financing inflow)
    post(db, company_id, [L("1020", debit="500000"), L("3010", credit="500000")],
         vtype="RV", ref="FS:cap")
    # 2) Chemical purchase, paid by bank (operating outflow) + input GST (asset)
    post(db, company_id,
         [L("1100", debit="100000"), L("1121", debit="9000"), L("1122", debit="9000"),
          L("1020", credit="118000")], vtype="PI", ref="FS:buy")
    # 3) Consume to WIP, 4) WIP -> FG
    post(db, company_id, [L("1080", debit="60000"), L("1100", credit="60000")], vtype="PJ", ref="FS:wip")
    post(db, company_id, [L("1085", debit="60000"), L("1080", credit="60000")], vtype="SJ", ref="FS:fg")
    # 5) Sales with GST, 6) COGS
    post(db, company_id,
         [L("1040", debit="236000"), L("4010", credit="200000"),
          L("2041", credit="18000"), L("2042", credit="18000")], vtype="SI", ref="FS:sale")
    post(db, company_id, [L("5150", debit="60000"), L("1085", credit="60000")], vtype="SJ", ref="FS:cogs")
    # 7) Customer receipt (operating inflow)
    post(db, company_id, [L("1020", debit="236000"), L("1040", credit="236000")], vtype="RV", ref="FS:rcpt")
    # 8) Machine bought: part bank (investing outflow), part term loan (non-cash financing)
    post(db, company_id,
         [L("1530", debit="200000"), L("1020", credit="150000"), L("2510", credit="50000")],
         vtype="JV", ref="FS:machine")


def test_profit_and_loss(db, company):
    _scenario(db, company.id)
    pnl = fs.profit_and_loss(db, company.id, FY_START, AS_OF)
    assert pnl["revenue_total"] == Decimal("200000.00")
    assert pnl["direct_expense_total"] == Decimal("60000.00")   # COGS
    assert pnl["gross_profit"] == Decimal("140000.00")
    assert pnl["indirect_expense_total"] == Decimal("0.00")
    assert pnl["net_profit"] == Decimal("140000.00")


def test_balance_sheet_balances(db, company):
    _scenario(db, company.id)
    bs = fs.balance_sheet(db, company.id, AS_OF, fy_start=FY_START)
    assert bs["is_balanced"] is True
    assert bs["assets_total"] == Decimal("726000.00")
    assert bs["liabilities_total"] == Decimal("86000.00")      # output GST 36k + term loan 50k
    assert bs["equity_total"] == Decimal("640000.00")          # capital 500k + profit 140k
    profit_line = next(e for e in bs["equity"] if e["account_code"] == "3040")
    assert profit_line["amount"] == Decimal("140000.00")
    # a spot asset
    bank = next(a for a in bs["assets"] if a["account_code"] == "1020")
    assert bank["amount"] == Decimal("468000.00")


def test_cash_flow(db, company):
    _scenario(db, company.id)
    cf = fs.cash_flow(db, company.id, FY_START, AS_OF)
    assert cf["opening_cash"] == Decimal("0.00")
    assert cf["closing_cash"] == Decimal("468000.00")
    assert cf["financing"] == Decimal("500000.00")             # capital in
    assert cf["investing"] == Decimal("-150000.00")            # machine (bank portion)
    assert cf["operating"] == Decimal("118000.00")             # -118k buy + 236k receipt
    assert cf["is_reconciled"] is True


def test_debtors_ageing_fifo(db, company, demo):
    cust = demo["customer_id"]
    # old invoice (98 days -> 90+), recent invoice (0-30), partial receipt
    post(db, company.id, [L("1040", debit="100000", party_type="customer", party_id=cust),
                          L("4010", credit="100000")], vtype="SI", ref="AGE:inv1", vdate=date(2026, 8, 1))
    post(db, company.id, [L("1040", debit="50000", party_type="customer", party_id=cust),
                          L("4010", credit="50000")], vtype="SI", ref="AGE:inv2", vdate=date(2026, 10, 20))
    post(db, company.id, [L("1020", debit="60000"),
                          L("1040", credit="60000", party_type="customer", party_id=cust)],
         vtype="RV", ref="AGE:rcpt", vdate=date(2026, 11, 1))

    ageing = fs.debtors_ageing(db, company.id, AS_OF)
    assert ageing["total"] == Decimal("90000.00")              # 150k invoiced - 60k received
    party = next(p for p in ageing["parties"] if p["party_id"] == str(cust))
    assert party["90+"] == Decimal("40000.00")                 # 100k - 60k FIFO, aged from Aug
    assert party["0-30"] == Decimal("50000.00")                # Oct invoice untouched


def test_statements_over_api(client, auth_headers, company, db):
    _scenario(db, company.id)
    bs = client.get("/api/reports/balance-sheet?as_of=2026-11-07", headers=auth_headers).json()
    assert bs["is_balanced"] is True
    assert bs["assets_total"] == "726000.00"

    pnl = client.get(
        "/api/reports/profit-and-loss?date_from=2026-04-01&date_to=2026-11-07", headers=auth_headers
    ).json()
    assert pnl["net_profit"] == "140000.00"

    cf = client.get(
        "/api/reports/cash-flow?date_from=2026-04-01&date_to=2026-11-07", headers=auth_headers
    ).json()
    assert cf["closing_cash"] == "468000.00" and cf["is_reconciled"] is True
