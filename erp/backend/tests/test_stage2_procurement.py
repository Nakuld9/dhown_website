"""Stage 2: chemical purchase (GRN) -> FIFO stock + GST purchase voucher.

Acceptance TEST 1: buy chemicals + GST, create the correct purchase voucher.
Acceptance TEST 18 (again): re-posting the same GRN never duplicates.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.commercial import DocStatus, GoodsReceiptNote, GRNLine
from app.models.inventory import ItemType
from app.services import inventory
from app.services.procurement import post_chemical_grn


def _make_grn(db, demo, qty="100", unit_cost="1200"):
    grn = GoodsReceiptNote(
        company_id=demo["company_id"], supplier_id=demo["supplier_id"],
        number="GRN-0001", grn_date=date(2026, 11, 7), supplier_invoice_no="SINV-1",
    )
    grn.lines.append(GRNLine(
        line_no=1, chemical_id=demo["chemicals"]["RB-01"], chemical_lot_id=demo["lots"]["RB-01"],
        warehouse_id=demo["warehouses"]["chem"], qty=Decimal(qty), unit_cost=Decimal(unit_cost),
        tax_code_id=demo["tax_id"],
    ))
    db.add(grn)
    db.flush()
    return grn


def test_chemical_grn_posts_inventory_and_gst_voucher(db, demo):
    before = inventory.balance(
        db, company_id=demo["company_id"], item_type=ItemType.CHEMICAL, item_id=demo["chemicals"]["RB-01"]
    )
    grn = _make_grn(db, demo, qty="100", unit_cost="1200")
    voucher = post_chemical_grn(db, grn)
    db.commit()

    # 100 * 1200 = 120,000 taxable; GST18 intra -> 10,800 + 10,800; gross 141,600.
    assert voucher.total_debit == voucher.total_credit == Decimal("141600.00")
    codes = {ln.account_id for ln in voucher.lines}
    assert len(codes) == 4  # inventory + CGST + SGST + payable
    assert grn.status == DocStatus.POSTED

    after = inventory.balance(
        db, company_id=demo["company_id"], item_type=ItemType.CHEMICAL, item_id=demo["chemicals"]["RB-01"]
    )
    assert after["qty_on_hand"] - before["qty_on_hand"] == Decimal("100.000000")


def test_grn_posting_is_idempotent(db, demo):
    grn = _make_grn(db, demo)
    v1 = post_chemical_grn(db, grn)
    db.commit()
    v2 = post_chemical_grn(db, grn)
    db.commit()
    assert v1.id == v2.id
