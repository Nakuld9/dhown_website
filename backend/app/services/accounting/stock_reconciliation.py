"""Stock-valuation vs general-ledger reconciliation (acceptance TEST 17).

For each inventory control account, compare the perpetual inventory valuation
(sum of FIFO layer remaining x unit cost) with the general-ledger balance of the
control account. They tie out because every stock movement posts a GL entry of
equal value through the posting engine (opening stock included, via the
opening-balance voucher).
"""
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.types import MONEY_SCALE, quantize
from app.models.accounting import ChartOfAccount, JournalLine, Voucher, VoucherStatus
from app.models.inventory import ItemType, StockLayer
from app.models.masters import Chemical

ZERO = quantize(0, MONEY_SCALE)
_POSTED = [s.value for s in (VoucherStatus.POSTED, VoucherStatus.REVERSED, VoucherStatus.REVERSAL)]

# control account -> how to select the stock layers that back it.
GROUPS = [
    {"account": "1100", "label": "Chemical Inventory", "item_type": ItemType.CHEMICAL, "is_dye": False},
    {"account": "1090", "label": "Dye Inventory", "item_type": ItemType.CHEMICAL, "is_dye": True},
    {"account": "1060", "label": "Yarn Inventory", "item_type": ItemType.YARN, "is_dye": None},
    {"account": "1070", "label": "Greige Fabric Inventory", "item_type": ItemType.FABRIC, "is_dye": None},
]


def _ledger_balance(db: Session, company_id: uuid.UUID, code: str, as_of: date | None) -> object:
    acct = db.execute(
        select(ChartOfAccount).where(ChartOfAccount.company_id == company_id, ChartOfAccount.code == code)
    ).scalar_one_or_none()
    if acct is None:
        return ZERO
    stmt = (
        select(JournalLine.debit, JournalLine.credit)
        .join(Voucher, JournalLine.voucher_id == Voucher.id)
        .where(Voucher.company_id == company_id, Voucher.status.in_(_POSTED),
               JournalLine.account_id == acct.id)
    )
    if as_of is not None:
        stmt = stmt.where(Voucher.voucher_date <= as_of)
    bal = ZERO
    for debit, credit in db.execute(stmt):
        bal += (debit or ZERO) - (credit or ZERO)
    return bal


def _stock_value(db: Session, company_id: uuid.UUID, item_type: ItemType, is_dye) -> object:
    itype = item_type.value
    dye_ids = None
    if is_dye is not None and item_type == ItemType.CHEMICAL:
        dye_ids = {
            c.id for c in db.execute(
                select(Chemical).where(Chemical.company_id == company_id, Chemical.is_dye.is_(is_dye))
            ).scalars()
        }
    value = ZERO
    for layer in db.execute(
        select(StockLayer).where(StockLayer.company_id == company_id, StockLayer.item_type == itype)
    ).scalars():
        if dye_ids is not None and layer.item_id not in dye_ids:
            continue
        value += layer.value_remaining or ZERO
    return value


def stock_ledger_reconciliation(db: Session, company_id: uuid.UUID, *, as_of: date | None = None) -> dict:
    rows = []
    all_ok = True
    tot_stock = tot_ledger = ZERO
    for g in GROUPS:
        stock = _stock_value(db, company_id, g["item_type"], g["is_dye"])
        ledger = _ledger_balance(db, company_id, g["account"], as_of)
        diff = ledger - stock
        ok = diff == ZERO
        all_ok = all_ok and ok
        tot_stock += stock
        tot_ledger += ledger
        rows.append({"account": g["account"], "label": g["label"], "stock_value": stock,
                     "ledger_balance": ledger, "difference": diff, "matched": ok})
    return {
        "as_of": as_of,
        "rows": rows,
        "total_stock_value": tot_stock,
        "total_ledger_balance": tot_ledger,
        "total_difference": tot_ledger - tot_stock,
        "is_reconciled": all_ok,
    }
