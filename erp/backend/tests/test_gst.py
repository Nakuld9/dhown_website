"""Stage 7 GST: registers, GSTR-1, GSTR-3B, and books reconciliation."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.commercial import GoodsReceiptNote, GRNLine, SalesInvoice, SalesInvoiceLine
from app.services import procurement, sales
from app.services.accounting import gst

FRM, TO = date(2026, 4, 1), date(2026, 11, 7)


def _post_docs(db, demo):
    grn = GoodsReceiptNote(company_id=demo["company_id"], supplier_id=demo["supplier_id"],
                           number="GRN-GST-1", grn_date=date(2026, 11, 7))
    grn.lines.append(GRNLine(line_no=1, chemical_id=demo["chemicals"]["RB-01"],
                             chemical_lot_id=demo["lots"]["RB-01"],
                             warehouse_id=demo["warehouses"]["chem"], qty=Decimal("100"),
                             unit_cost=Decimal("1200"), tax_code_id=demo["tax_id"]))
    db.add(grn)
    db.flush()
    procurement.post_chemical_grn(db, grn)

    inv = SalesInvoice(company_id=demo["company_id"], customer_id=demo["customer_id"],
                       number="INV-GST-1", invoice_date=date(2026, 11, 7))
    inv.lines.append(SalesInvoiceLine(line_no=1, description="Dyed fabric", qty=Decimal("250"),
                                      rate=Decimal("800"), tax_code_id=demo["tax_id"]))
    db.add(inv)
    db.flush()
    sales.post_sales_invoice(db, inv)
    db.commit()


def test_sales_and_purchase_registers(db, demo):
    _post_docs(db, demo)
    sr = gst.sales_register(db, demo["company_id"], FRM, TO)["totals"]
    assert sr["taxable"] == Decimal("200000.00")
    assert sr["cgst"] == sr["sgst"] == Decimal("18000.00")
    assert sr["igst"] == Decimal("0.00")

    pr = gst.purchase_register(db, demo["company_id"], FRM, TO)["totals"]
    assert pr["taxable"] == Decimal("120000.00")
    assert pr["cgst"] == pr["sgst"] == Decimal("10800.00")


def test_gstr3b_net_payable(db, demo):
    _post_docs(db, demo)
    r = gst.gstr3b_summary(db, demo["company_id"], FRM, TO)
    assert r["outward_taxable_supplies"]["taxable_value"] == Decimal("200000.00")
    assert r["eligible_itc"]["cgst"] == Decimal("10800.00")
    # net = output 18,000 - ITC 10,800 = 7,200 per head
    assert r["net_tax_payable"]["cgst"] == Decimal("7200.00")
    assert r["net_tax_payable"]["sgst"] == Decimal("7200.00")
    assert r["net_tax_payable"]["total"] == Decimal("14400.00")


def test_gstr1_b2b_and_rate_wise(db, demo):
    _post_docs(db, demo)
    r = gst.gstr1_summary(db, demo["company_id"], FRM, TO)
    # demo customer has a GSTIN -> B2B
    assert r["b2b"]["taxable"] == Decimal("200000.00")
    assert r["b2b"]["invoices"] == 1
    assert r["b2c"]["taxable"] == Decimal("0.00")
    assert r["rate_wise"]["18"]["taxable"] == Decimal("200000.00")


def test_books_reconcile_with_gst_registers(db, demo):
    _post_docs(db, demo)
    rec = gst.book_vs_gst_reconciliation(db, demo["company_id"], FRM, TO)
    assert rec["is_reconciled"] is True
    for chk in rec["checks"]:
        assert chk["difference"] == Decimal("0.00")


def test_gst_endpoints_over_api(client, auth_headers, db, demo):
    _post_docs(db, demo)
    q = "date_from=2026-04-01&date_to=2026-11-07"
    r3b = client.get(f"/api/reports/gst/gstr3b?{q}", headers=auth_headers).json()
    assert r3b["net_tax_payable"]["total"] == "14400.00"
    rec = client.get(f"/api/reports/gst/reconciliation?{q}", headers=auth_headers).json()
    assert rec["is_reconciled"] is True
