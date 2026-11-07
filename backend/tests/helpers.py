"""Shared test helpers."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from app.services.accounting import posting_engine as pe

# All test vouchers fall inside the seeded FY 2026-2027 (open periods).
VDATE = date(2026, 11, 7)


def L(account_code: str, debit="0", credit="0", **kw) -> pe.PostingLine:
    return pe.PostingLine(account_code=account_code, debit=Decimal(debit), credit=Decimal(credit), **kw)


def post(db, company_id: uuid.UUID, lines, *, vtype="JV", ref=None, vdate=VDATE, narration="test"):
    req = pe.PostingRequest(
        company_id=company_id,
        voucher_type_code=vtype,
        voucher_date=vdate,
        posting_reference=ref or f"TEST:{uuid.uuid4()}",
        narration=narration,
        lines=lines,
    )
    voucher = pe.post_voucher(db, req)
    db.commit()
    return voucher
