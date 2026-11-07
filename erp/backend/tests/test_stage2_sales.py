"""Stage 2: sales invoice posting with GST (acceptance TEST 13)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.commercial import DocStatus, SalesInvoice, SalesInvoiceLine
from app.services.sales import post_sales_invoice


def test_sales_invoice_posts_with_gst(db, demo):
    inv = SalesInvoice(company_id=demo["company_id"], customer_id=demo["customer_id"],
                       number="INV-0001", invoice_date=date(2026, 11, 7))
    inv.lines.append(SalesInvoiceLine(line_no=1, description="Dyed fabric 250kg",
                                      qty=Decimal("250"), rate=Decimal("800"),
                                      tax_code_id=demo["tax_id"]))
    db.add(inv)
    db.flush()

    voucher = post_sales_invoice(db, inv)
    db.commit()

    # 250 * 800 = 200,000 taxable; GST18 intra -> 18,000 + 18,000; total 236,000.
    assert inv.taxable_value == Decimal("200000.00")
    assert inv.tax_amount == Decimal("36000.00")
    assert inv.total_value == Decimal("236000.00")
    assert inv.status == DocStatus.POSTED
    assert voucher.total_debit == voucher.total_credit == Decimal("236000.00")
    # receivable debit + sales credit + 2 GST credits
    assert len(voucher.lines) == 4
