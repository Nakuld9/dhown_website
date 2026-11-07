"""Per-bath actual-consumption register (brief §10): recipe target vs actual,
variance, chemical/dye cost, consumption per kg, and total bath cost."""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.types import MONEY_SCALE, QTY_SCALE, quantize
from app.models.dispensing import DispensingTransaction
from app.models.manufacturing import DyeBath
from app.models.masters import Chemical, RecipeVersion
from app.services.manufacturing.recipes import scale_recipe


def bath_consumption_register(db: Session, bath: DyeBath) -> dict:
    fabric_kg = Decimal(str(bath.fabric_kg)) or Decimal("1")

    targets: dict[str, Decimal] = {}
    if bath.recipe_version_id:
        version = db.get(RecipeVersion, bath.recipe_version_id)
        for m in scale_recipe(db, version, bath.fabric_kg, require_approved=False):
            targets[str(m["chemical_id"])] = Decimal(str(m["required_kg"]))

    txns = db.execute(
        select(DispensingTransaction).where(DispensingTransaction.bath_id == bath.id)
    ).scalars().all()

    actuals: dict[str, Decimal] = {}
    costs: dict[str, Decimal] = {}
    for t in txns:
        key = str(t.chemical_id)
        actuals[key] = actuals.get(key, Decimal("0")) + Decimal(str(t.actual_weight))
        costs[key] = costs.get(key, Decimal("0")) + Decimal(str(t.consumption_cost or 0))

    rows = []
    total_cost = Decimal("0")
    total_actual = Decimal("0")
    for chem_id in sorted(set(targets) | set(actuals)):
        chem = db.get(Chemical, uuid.UUID(chem_id))
        target = targets.get(chem_id, Decimal("0"))
        actual = actuals.get(chem_id, Decimal("0"))
        cost = quantize(costs.get(chem_id, Decimal("0")), MONEY_SCALE)
        total_cost += cost
        total_actual += actual
        rows.append({
            "material_code": chem.code if chem else None,
            "name": chem.name if chem else None,
            "is_dye": bool(chem.is_dye) if chem else False,
            "recipe_target_kg": quantize(target, QTY_SCALE),
            "actual_kg": quantize(actual, QTY_SCALE),
            "variance_kg": quantize(actual - target, QTY_SCALE),
            "cost": cost,
            "consumption_per_kg": quantize(actual / fabric_kg, QTY_SCALE),
        })

    return {
        "bath_code": bath.bath_code,
        "fabric_kg": quantize(fabric_kg, QTY_SCALE),
        "rows": rows,
        "total_actual_kg": quantize(total_actual, QTY_SCALE),
        "total_cost": quantize(total_cost, MONEY_SCALE),
        "cost_per_kg_fabric": quantize(total_cost / fabric_kg, MONEY_SCALE),
    }
