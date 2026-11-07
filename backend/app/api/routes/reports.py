"""Reporting routes: trial balance and account ledger."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_permission
from app.models.core import User
from app.services.accounting import trial_balance as tb

router = APIRouter(prefix="/api/reports", tags=["reports"])


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
        return tb.account_ledger(
            db, user.company_id, account_code, date_from=date_from, date_to=date_to
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
