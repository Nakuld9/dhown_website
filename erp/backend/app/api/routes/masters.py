"""Master-data routes (customers & suppliers as the representative slice)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_permission
from app.models.core import User
from app.models.masters import (
    Chemical,
    Customer,
    Machine,
    Recipe,
    RecipeVersion,
    ShadeCode,
    Supplier,
    TaxCode,
    Warehouse,
)
from app.schemas import CustomerCreate, PartyOut, SupplierCreate, WarehouseCreate, WarehouseOut

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


@router.get("/warehouses", response_model=list[WarehouseOut])
def list_warehouses(
    db: Session = Depends(get_db), user: User = Depends(require_permission("master.read"))
):
    return (
        db.execute(select(Warehouse).where(Warehouse.company_id == user.company_id).order_by(Warehouse.code))
        .scalars()
        .all()
    )


@router.post("/warehouses", response_model=WarehouseOut, status_code=status.HTTP_201_CREATED)
def create_warehouse(
    payload: WarehouseCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("master.write")),
):
    exists = db.execute(
        select(Warehouse).where(Warehouse.company_id == user.company_id, Warehouse.code == payload.code)
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Warehouse code {payload.code} already exists")
    wh = Warehouse(company_id=user.company_id, created_by=user.id, **payload.model_dump())
    db.add(wh)
    db.commit()
    db.refresh(wh)
    return wh


# --- read-only lookup lists (populate transaction-entry dropdowns) ----------

@router.get("/chemicals")
def list_chemicals(db: Session = Depends(get_db), user: User = Depends(require_permission("master.read"))):
    rows = db.execute(select(Chemical).where(
        Chemical.company_id == user.company_id, Chemical.is_active.is_(True)).order_by(Chemical.code)).scalars().all()
    return [{"id": str(c.id), "code": c.code, "name": c.name, "is_dye": c.is_dye,
             "tax_code_id": str(c.tax_code_id) if c.tax_code_id else None} for c in rows]


@router.get("/tax-codes")
def list_tax_codes(db: Session = Depends(get_db), user: User = Depends(require_permission("master.read"))):
    rows = db.execute(select(TaxCode).where(
        TaxCode.company_id == user.company_id, TaxCode.is_active.is_(True)).order_by(TaxCode.code)).scalars().all()
    return [{"id": str(t.id), "code": t.code, "name": t.name} for t in rows]


@router.get("/machines")
def list_machines(machine_type: str | None = None, db: Session = Depends(get_db),
                  user: User = Depends(require_permission("master.read"))):
    stmt = select(Machine).where(Machine.company_id == user.company_id, Machine.is_active.is_(True))
    if machine_type:
        stmt = stmt.where(Machine.machine_type == machine_type)
    rows = db.execute(stmt.order_by(Machine.code)).scalars().all()
    return [{"id": str(m.id), "code": m.code, "name": m.name, "machine_type": m.machine_type} for m in rows]


@router.get("/shades")
def list_shades(db: Session = Depends(get_db), user: User = Depends(require_permission("master.read"))):
    rows = db.execute(select(ShadeCode).where(
        ShadeCode.company_id == user.company_id, ShadeCode.is_active.is_(True)).order_by(ShadeCode.code)).scalars().all()
    return [{"id": str(s.id), "code": s.code, "name": s.name} for s in rows]


@router.get("/recipe-versions")
def list_recipe_versions(db: Session = Depends(get_db), user: User = Depends(require_permission("master.read"))):
    rows = db.execute(
        select(RecipeVersion, Recipe).join(Recipe, RecipeVersion.recipe_id == Recipe.id).where(
            Recipe.company_id == user.company_id, RecipeVersion.status == "APPROVED")
        .order_by(Recipe.code, RecipeVersion.version_no)
    ).all()
    return [{"id": str(v.id), "label": f"{r.code} v{v.version_no}", "recipe_code": r.code,
             "version_no": v.version_no} for v, r in rows]
