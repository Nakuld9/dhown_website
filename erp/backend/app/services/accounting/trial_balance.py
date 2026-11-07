"""Trial balance and ledger reporting.

Balances are derived directly from posted journal lines (never from a mutable
cache), so the report is always consistent with the immutable ledger. All
non-DRAFT vouchers are included: a REVERSED voucher's original lines and its
REVERSAL counter-lines both appear and net to zero, keeping the trial balance
balanced by construction.
"""
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.types import MONEY_SCALE, quantize
from app.models.accounting import ChartOfAccount, JournalLine, Voucher, VoucherStatus

ZERO = quantize(0, MONEY_SCALE)
_POSTED = (VoucherStatus.POSTED, VoucherStatus.REVERSED, VoucherStatus.REVERSAL)


def _split(net):
    """Split a signed net balance into (debit, credit) columns."""
    if net >= ZERO:
        return net, ZERO
    return ZERO, -net


def trial_balance(
    db: Session,
    company_id: uuid.UUID,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    accounts = db.execute(
        select(ChartOfAccount).where(
            ChartOfAccount.company_id == company_id, ChartOfAccount.is_group.is_(False)
        )
    ).scalars().all()

    rows = []
    tot_open_d = tot_open_c = ZERO
    tot_per_d = tot_per_c = ZERO
    tot_close_d = tot_close_c = ZERO

    for acct in accounts:
        base = (
            select(JournalLine.debit, JournalLine.credit, Voucher.voucher_date)
            .join(Voucher, JournalLine.voucher_id == Voucher.id)
            .where(
                JournalLine.account_id == acct.id,
                Voucher.company_id == company_id,
                Voucher.status.in_([s.value for s in _POSTED]),
            )
        )
        opening_d = opening_c = ZERO
        period_d = period_c = ZERO
        for debit, credit, vdate in db.execute(base):
            d = debit or ZERO
            c = credit or ZERO
            if date_from is not None and vdate < date_from:
                opening_d += d
                opening_c += c
            else:
                in_window = date_to is None or vdate <= date_to
                if in_window:
                    period_d += d
                    period_c += c

        if opening_d == ZERO and opening_c == ZERO and period_d == ZERO and period_c == ZERO:
            continue

        opening_net = opening_d - opening_c
        closing_net = opening_net + (period_d - period_c)
        od, oc = _split(opening_net)
        cd, cc = _split(closing_net)

        rows.append(
            {
                "account_code": acct.code,
                "account_name": acct.name,
                "account_type": acct.account_type,
                "opening_debit": od,
                "opening_credit": oc,
                "period_debit": period_d,
                "period_credit": period_c,
                "closing_debit": cd,
                "closing_credit": cc,
            }
        )
        tot_open_d += od
        tot_open_c += oc
        tot_per_d += period_d
        tot_per_c += period_c
        tot_close_d += cd
        tot_close_c += cc

    rows.sort(key=lambda r: r["account_code"])
    return {
        "rows": rows,
        "totals": {
            "opening_debit": tot_open_d,
            "opening_credit": tot_open_c,
            "period_debit": tot_per_d,
            "period_credit": tot_per_c,
            "closing_debit": tot_close_d,
            "closing_credit": tot_close_c,
        },
        "is_balanced": tot_per_d == tot_per_c and tot_close_d == tot_close_c,
    }


def account_ledger(
    db: Session,
    company_id: uuid.UUID,
    account_code: str,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    """Ledger of one account with a running balance (drill-down to vouchers)."""
    acct = db.execute(
        select(ChartOfAccount).where(
            ChartOfAccount.company_id == company_id, ChartOfAccount.code == account_code
        )
    ).scalar_one_or_none()
    if acct is None:
        raise ValueError(f"Account {account_code} not found")

    q = (
        select(JournalLine, Voucher)
        .join(Voucher, JournalLine.voucher_id == Voucher.id)
        .where(
            JournalLine.account_id == acct.id,
            Voucher.company_id == company_id,
            Voucher.status.in_([s.value for s in _POSTED]),
        )
        .order_by(Voucher.voucher_date, Voucher.number, JournalLine.line_no)
    )
    entries = []
    running = ZERO
    for line, voucher in db.execute(q):
        if date_from and voucher.voucher_date < date_from:
            running += (line.debit or ZERO) - (line.credit or ZERO)
            continue
        if date_to and voucher.voucher_date > date_to:
            continue
        running += (line.debit or ZERO) - (line.credit or ZERO)
        entries.append(
            {
                "date": voucher.voucher_date,
                "voucher_number": voucher.number,
                "voucher_id": str(voucher.id),
                "narration": line.narration or voucher.narration,
                "debit": line.debit or ZERO,
                "credit": line.credit or ZERO,
                "running_balance": running,
            }
        )
    return {
        "account_code": acct.code,
        "account_name": acct.name,
        "closing_balance": running,
        "entries": entries,
    }
