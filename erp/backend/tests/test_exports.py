"""Stage 9: Excel/PDF report exports."""
from __future__ import annotations

import io
from datetime import date

from openpyxl import load_workbook

from app.services.exports import render_excel, render_pdf
from app.services.exports.builders import build_report
from tests.helpers import L, post


def _scenario(db, company_id):
    post(db, company_id, [L("1020", debit="500000"), L("3010", credit="500000")],
         vtype="RV", ref="EXP:cap")
    post(db, company_id,
         [L("1040", debit="236000"), L("4010", credit="200000"),
          L("2041", credit="18000"), L("2042", credit="18000")], vtype="SI", ref="EXP:sale")


def test_render_excel_and_pdf_bytes(db, company):
    _scenario(db, company.id)
    doc = build_report(db, company.id, "trial-balance")
    xlsx = render_excel(doc)
    pdf = render_pdf(doc)
    assert xlsx[:2] == b"PK"        # xlsx is a zip
    assert pdf[:4] == b"%PDF"
    # Round-trip the workbook and confirm the title + a known account landed.
    wb = load_workbook(io.BytesIO(xlsx))
    ws = wb.active
    assert ws.cell(1, 1).value == "Trial Balance"
    codes = [ws.cell(r, 1).value for r in range(1, ws.max_row + 1)]
    assert "1020" in codes and "4010" in codes


def test_all_financial_reports_build(db, company):
    _scenario(db, company.id)
    for report in ("trial-balance", "profit-and-loss", "balance-sheet", "cash-flow",
                   "debtors-ageing", "creditors-ageing"):
        doc = build_report(db, company.id, report)
        assert render_excel(doc)[:2] == b"PK"
        assert render_pdf(doc)[:4] == b"%PDF"


def test_export_endpoints(client, auth_headers, company, db):
    _scenario(db, company.id)
    x = client.get("/api/reports/export/profit-and-loss?format=xlsx", headers=auth_headers)
    assert x.status_code == 200
    assert x.headers["content-type"].startswith("application/vnd.openxml")
    assert "attachment" in x.headers["content-disposition"]
    assert x.content[:2] == b"PK"

    p = client.get("/api/reports/export/balance-sheet?format=pdf", headers=auth_headers)
    assert p.status_code == 200 and p.content[:4] == b"%PDF"

    assert client.get("/api/reports/export/trial-balance?format=csv", headers=auth_headers).status_code == 400
    assert client.get("/api/reports/export/nope?format=xlsx", headers=auth_headers).status_code == 404
    # bath-register needs a bath_id
    assert client.get("/api/reports/export/bath-register?format=xlsx", headers=auth_headers).status_code == 404


def test_gst_register_export(client, auth_headers, demo, db):
    # post a sales invoice so the register has a row
    from app.models.commercial import SalesInvoice, SalesInvoiceLine
    from app.services.sales import post_sales_invoice
    from decimal import Decimal
    inv = SalesInvoice(company_id=demo["company_id"], customer_id=demo["customer_id"],
                       number="INV-EXP-1", invoice_date=date(2026, 11, 7))
    inv.lines.append(SalesInvoiceLine(line_no=1, description="Fabric", qty=Decimal("250"),
                                      rate=Decimal("800"), tax_code_id=demo["tax_id"]))
    db.add(inv)
    db.flush()
    post_sales_invoice(db, inv)
    db.commit()

    r = client.get("/api/reports/export/gst-sales-register?format=xlsx", headers=auth_headers)
    assert r.status_code == 200 and r.content[:2] == b"PK"
