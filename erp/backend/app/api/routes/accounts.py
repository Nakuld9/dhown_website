"""Chart of accounts routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_permission
from app.models.accounting import ChartOfAccount
from app.models.core import User
from app.schemas import AccountOut

router = APIRouter(prefix="/api/accounts", tags=["accounting"])


@router.get("", response_model=list[AccountOut])
def list_accounts(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("master.read")),
) -> list[ChartOfAccount]:
    return (
        db.execute(
            select(ChartOfAccount)
            .where(ChartOfAccount.company_id == user.company_id)
            .order_by(ChartOfAccount.code)
        )
        .scalars()
        .all()
    )
