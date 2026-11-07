"""Reporting routes: trial balance, ledger, and financial statements."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_permission
from app.models.core import User
from app.services.accounting import financial_statements as fs
from app.services.accounting import trial_balance as tb

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _stringify(obj):
    """Recursively convert Decimals to strings for lossless JSON."""
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, dict):
        return {k: _stringify(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_stringify(v) for v in obj]
    return obj


def _fy_start(d: date) -> date:
    return date(d.year if d.month >= 4 else d.year - 1, 4, 1)


@router.get("/trial-balance")
def get_trial_balance(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("report.financial")),
) -> dict:
    return tb.trial_balance(db, user.company_id, date_from=date_from, date_to=date_to)


@router.get("/ledger/{account_code}")
def get_account_ledger(
    account_code: str,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("report.read")),
) -> dict:
    try:
        return _stringify(tb.account_ledger(
            db, user.company_id, account_code, date_from=date_from, date_to=date_to
        ))
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))


@router.get("/profit-and-loss")
def profit_and_loss(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("report.financial")),
) -> dict:
    to = date_to or date.today()
    frm = date_from or _fy_start(to)
    return _stringify(fs.profit_and_loss(db, user.company_id, frm, to))


@router.get("/balance-sheet")
def balance_sheet(
    as_of: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("report.financial")),
) -> dict:
    return _stringify(fs.balance_sheet(db, user.company_id, as_of or date.today()))


@router.get("/cash-flow")
def cash_flow(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("report.financial")),
) -> dict:
    to = date_to or date.today()
    frm = date_from or _fy_start(to)
    return _stringify(fs.cash_flow(db, user.company_id, frm, to))


@router.get("/debtors-ageing")
def debtors_ageing(
    as_of: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("report.read")),
) -> dict:
    return _stringify(fs.debtors_ageing(db, user.company_id, as_of or date.today()))


@router.get("/creditors-ageing")
def creditors_ageing(
    as_of: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("report.read")),
) -> dict:
    return _stringify(fs.creditors_ageing(db, user.company_id, as_of or date.today()))
