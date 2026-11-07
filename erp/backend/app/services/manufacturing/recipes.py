"""Recipe scaling. Scales an approved recipe version to the bath fabric weight.

Supports %OWF (on weight of fabric) and grams-per-kg materials:
    required_kg = fabric_kg * percent_owf / 100
    required_kg = fabric_kg * grams_per_kg / 1000
Example (brief §9): 250 kg fabric, Reactive Blue 1.4% OWF -> 3.50 kg.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.types import QTY_SCALE, quantize
from app.models.masters import Chemical, RecipeVersion


class RecipeNotApprovedError(Exception):
    pass


def scale_recipe(db: Session, version: RecipeVersion, fabric_kg, *, require_approved: bool = True) -> list[dict]:
    if require_approved and version.status != "APPROVED":
        raise RecipeNotApprovedError(
            f"Recipe version {version.id} is '{version.status}', only APPROVED recipes go to production."
        )
    fabric_kg = Decimal(str(fabric_kg))
    out = []
    for mat in sorted(version.materials, key=lambda m: m.sequence):
        if mat.percent_owf is not None:
            required = fabric_kg * Decimal(str(mat.percent_owf)) / Decimal("100")
        elif mat.grams_per_kg is not None:
            required = fabric_kg * Decimal(str(mat.grams_per_kg)) / Decimal("1000")
        else:
            required = Decimal("0")
        chem = db.get(Chemical, mat.chemical_id)
        out.append({
            "chemical_id": mat.chemical_id,
            "material_code": chem.code if chem else None,
            "name": chem.name if chem else None,
            "is_dye": bool(chem.is_dye) if chem else False,
            "sequence": mat.sequence,
            "required_kg": quantize(required, QTY_SCALE),
        })
    return out
