"""Convert report-service outputs into ReportDoc for export, with a dispatcher."""
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.manufacturing import DyeBath
from app.models.masters import Customer, Supplier
from app.services.accounting import financial_statements as fs
from app.services.accounting import gst as gst_svc
from app.services.accounting import stock_reconciliation as stock_recon
from app.services.accounting import trial_balance as tb
from app.services.colorservice.register import bath_consumption_register
from app.services.exports.document import Column, ReportDoc, Summary, Table


def _fy_start(d: date) -> date:
    return date(d.year if d.month >= 4 else d.year - 1, 4, 1)


def _period_sub(date_from, date_to):
    return f"{date_from.isoformat()} to {date_to.isoformat()}"


# ------------------------------- builders ----------------------------------

def _trial_balance(db, company_id, date_from, date_to) -> ReportDoc:
    data = tb.trial_balance(db, company_id, date_from=date_from, date_to=date_to)
    cols = [
        Column("Code", "account_code"), Column("Account", "account_name"),
        Column("Opening Dr", "opening_debit", True), Column("Opening Cr", "opening_credit", True),
        Column("Debit", "period_debit", True), Column("Credit", "period_credit", True),
        Column("Closing Dr", "closing_debit", True), Column("Closing Cr", "closing_credit", True),
    ]
    return ReportDoc("Trial Balance", _period_sub(date_from, date_to),
                     [Table("Accounts", cols, data["rows"], data["totals"])])


def _profit_and_loss(db, company_id, date_from, date_to) -> ReportDoc:
    p = fs.profit_and_loss(db, company_id, date_from, date_to)
    cols = [Column("Code", "account_code"), Column("Account", "name"), Column("Amount", "amount", True)]
    blocks = [
        Table("Income", cols, p["income"], {"amount": p["revenue_total"]}),
        Table("Direct Expenses (COGS)", cols, p["direct_expenses"], {"amount": p["direct_expense_total"]}),
        Table("Indirect Expenses", cols, p["indirect_expenses"], {"amount": p["indirect_expense_total"]}),
        Summary("Result", [
            ("Revenue", p["revenue_total"]), ("Direct expenses (COGS)", p["direct_expense_total"]),
            ("Gross profit", p["gross_profit"]), ("Indirect expenses", p["indirect_expense_total"]),
            ("Net profit", p["net_profit"]),
        ]),
    ]
    return ReportDoc("Profit & Loss Account", _period_sub(date_from, date_to), blocks)


def _balance_sheet(db, company_id, as_of) -> ReportDoc:
    b = fs.balance_sheet(db, company_id, as_of)
    cols = [Column("Code", "account_code"), Column("Account", "name"), Column("Amount", "amount", True)]
    blocks = [
        Table("Assets", cols, b["assets"], {"amount": b["assets_total"]}),
        Table("Liabilities", cols, b["liabilities"], {"amount": b["liabilities_total"]}),
        Table("Equity", cols, b["equity"], {"amount": b["equity_total"]}),
        Summary("Totals", [
            ("Total assets", b["assets_total"]),
            ("Total liabilities", b["liabilities_total"]),
            ("Total equity", b["equity_total"]),
            ("Liabilities + equity", b["liabilities_and_equity_total"]),
            ("Balanced", "Yes" if b["is_balanced"] else "No"),
        ]),
    ]
    return ReportDoc("Balance Sheet", f"As at {as_of.isoformat()}", blocks)


def _cash_flow(db, company_id, date_from, date_to) -> ReportDoc:
    c = fs.cash_flow(db, company_id, date_from, date_to)
    return ReportDoc("Cash Flow Statement", _period_sub(date_from, date_to), [
        Summary("Cash movements", [
            ("Opening cash & bank", c["opening_cash"]),
            ("Operating activities", c["operating"]),
            ("Investing activities", c["investing"]),
            ("Financing activities", c["financing"]),
            ("Net change", c["net_change"]),
            ("Closing cash & bank", c["closing_cash"]),
        ]),
    ])


def _ageing(db, company_id, as_of, which) -> ReportDoc:
    data = fs.debtors_ageing(db, company_id, as_of) if which == "debtors" else \
        fs.creditors_ageing(db, company_id, as_of)
    model = Customer if which == "debtors" else Supplier
    names = {str(m.id): m.name for m in db.execute(
        select(model).where(model.company_id == company_id)).scalars()}
    rows = []
    for p in data["parties"]:
        rows.append({"party": names.get(p["party_id"], p["party_id"]),
                     "outstanding": p["outstanding"], "b0": p["0-30"], "b1": p["31-60"],
                     "b2": p["61-90"], "b3": p["90+"]})
    cols = [Column("Party", "party"), Column("Outstanding", "outstanding", True),
            Column("0-30", "b0", True), Column("31-60", "b1", True),
            Column("61-90", "b2", True), Column("90+", "b3", True)]
    title = "Debtors Ageing" if which == "debtors" else "Creditors Ageing"
    return ReportDoc(title, f"As at {as_of.isoformat()}",
                     [Table("Outstanding by party", cols, rows, {"outstanding": data["total"]})])


def _gst_register(db, company_id, date_from, date_to, which) -> ReportDoc:
    data = (gst_svc.sales_register if which == "sales" else gst_svc.purchase_register)(
        db, company_id, date_from, date_to)
    cols = [Column("Document", "document"), Column("Date", "date"), Column("Party", "party"),
            Column("GSTIN", "gstin"), Column("Taxable", "taxable", True),
            Column("CGST", "cgst", True), Column("SGST", "sgst", True),
            Column("IGST", "igst", True), Column("Total", "total", True)]
    title = "GST Sales Register" if which == "sales" else "GST Purchase Register"
    return ReportDoc(title, _period_sub(date_from, date_to),
                     [Table("Documents", cols, data["rows"], data["totals"])])


def _gstr3b(db, company_id, date_from, date_to) -> ReportDoc:
    r = gst_svc.gstr3b_summary(db, company_id, date_from, date_to)
    out, itc, pay = r["outward_taxable_supplies"], r["eligible_itc"], r["net_tax_payable"]
    return ReportDoc("GSTR-3B Summary", _period_sub(date_from, date_to), [
        Summary("3.1 Outward taxable supplies", [
            ("Taxable value", out["taxable_value"]), ("CGST", out["cgst"]),
            ("SGST", out["sgst"]), ("IGST", out["igst"])]),
        Summary("4 Eligible ITC", [("CGST", itc["cgst"]), ("SGST", itc["sgst"]), ("IGST", itc["igst"])]),
        Summary("5/6 Net tax payable", [
            ("CGST", pay["cgst"]), ("SGST", pay["sgst"]), ("IGST", pay["igst"]), ("Total", pay["total"])]),
    ])


def _bath_register(db, company_id, bath_id) -> ReportDoc:
    bath = db.get(DyeBath, uuid.UUID(bath_id)) if isinstance(bath_id, str) else db.get(DyeBath, bath_id)
    if bath is None or bath.company_id != company_id:
        raise ValueError("Bath not found")
    reg = bath_consumption_register(db, bath)
    cols = [Column("Material", "material_code"), Column("Name", "name"),
            Column("Recipe (kg)", "recipe_target_kg", True), Column("Actual (kg)", "actual_kg", True),
            Column("Variance (kg)", "variance_kg", True), Column("Cost", "cost", True),
            Column("Per kg fabric", "consumption_per_kg", True)]
    return ReportDoc(f"Dye-Bath Consumption Register — {reg['bath_code']}",
                     f"Fabric {reg['fabric_kg']} kg", [
                         Table("Materials", cols, reg["rows"],
                               {"actual_kg": reg["total_actual_kg"], "cost": reg["total_cost"]}),
                         Summary("Totals", [
                             ("Fabric (kg)", reg["fabric_kg"]), ("Total cost", reg["total_cost"]),
                             ("Cost per kg fabric", reg["cost_per_kg_fabric"])]),
                     ])


def _stock_reconciliation(db, company_id, as_of) -> ReportDoc:
    data = stock_recon.stock_ledger_reconciliation(db, company_id, as_of=as_of)
    cols = [Column("A/c", "account"), Column("Control account", "label"),
            Column("Stock value", "stock_value", True), Column("Ledger balance", "ledger_balance", True),
            Column("Difference", "difference", True), Column("Matched", "matched")]
    rows = [{**r, "matched": "Yes" if r["matched"] else "No"} for r in data["rows"]]
    total = {"stock_value": data["total_stock_value"], "ledger_balance": data["total_ledger_balance"],
             "difference": data["total_difference"]}
    sub = f"As at {as_of.isoformat()}" if as_of else "Current"
    return ReportDoc("Stock vs GL Reconciliation", sub, [
        Table("Inventory control accounts", cols, rows, total),
        Summary("Result", [("Reconciled", "Yes" if data["is_reconciled"] else "No")]),
    ])


# ------------------------------- dispatch ----------------------------------

def build_report(db: Session, company_id: uuid.UUID, report: str, *, date_from: date | None = None,
                 date_to: date | None = None, as_of: date | None = None, bath_id=None) -> ReportDoc:
    to = date_to or date.today()
    frm = date_from or _fy_start(to)
    aod = as_of or date.today()
    if report == "trial-balance":
        return _trial_balance(db, company_id, frm, to)
    if report == "profit-and-loss":
        return _profit_and_loss(db, company_id, frm, to)
    if report == "balance-sheet":
        return _balance_sheet(db, company_id, aod)
    if report == "cash-flow":
        return _cash_flow(db, company_id, frm, to)
    if report == "debtors-ageing":
        return _ageing(db, company_id, aod, "debtors")
    if report == "creditors-ageing":
        return _ageing(db, company_id, aod, "creditors")
    if report == "gst-sales-register":
        return _gst_register(db, company_id, frm, to, "sales")
    if report == "gst-purchase-register":
        return _gst_register(db, company_id, frm, to, "purchase")
    if report == "gstr3b":
        return _gstr3b(db, company_id, frm, to)
    if report == "bath-register":
        if not bath_id:
            raise ValueError("bath_id is required for the bath-register export")
        return _bath_register(db, company_id, bath_id)
    if report == "stock-reconciliation":
        return _stock_reconciliation(db, company_id, aod)
    raise ValueError(f"Unknown report '{report}'")


REPORTS = [
    "trial-balance", "profit-and-loss", "balance-sheet", "cash-flow",
    "debtors-ageing", "creditors-ageing", "gst-sales-register",
    "gst-purchase-register", "gstr3b", "bath-register", "stock-reconciliation",
]
