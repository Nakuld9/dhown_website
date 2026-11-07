"""Master-data routes (customers & suppliers as the representative slice)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_permission
from app.models.core import User
from app.models.masters import Customer, Supplier
from app.schemas import CustomerCreate, PartyOut, SupplierCreate

router = APIRouter(prefix="/api/masters", tags=["masters"])


@router.get("/customers", response_model=list[PartyOut])
def list_customers(
    db: Session = Depends(get_db), user: User = Depends(require_permission("master.read"))
):
    return (
        db.execute(select(Customer).where(Customer.company_id == user.company_id).order_by(Customer.code))
        .scalars()
        .all()
    )


@router.post("/customers", response_model=PartyOut, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("master.write")),
):
    exists = db.execute(
        select(Customer).where(Customer.company_id == user.company_id, Customer.code == payload.code)
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Customer code {payload.code} already exists")
    cust = Customer(company_id=user.company_id, created_by=user.id, **payload.model_dump())
    db.add(cust)
    db.commit()
    db.refresh(cust)
    return cust


@router.get("/suppliers", response_model=list[PartyOut])
def list_suppliers(
    db: Session = Depends(get_db), user: User = Depends(require_permission("master.read"))
):
    return (
        db.execute(select(Supplier).where(Supplier.company_id == user.company_id).order_by(Supplier.code))
        .scalars()
        .all()
    )


@router.post("/suppliers", response_model=PartyOut, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("master.write")),
):
    exists = db.execute(
        select(Supplier).where(Supplier.company_id == user.company_id, Supplier.code == payload.code)
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Supplier code {payload.code} already exists")
    sup = Supplier(company_id=user.company_id, created_by=user.id, **payload.model_dump())
    db.add(sup)
    db.commit()
    db.refresh(sup)
    return sup
