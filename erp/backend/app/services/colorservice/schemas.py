"""Vendor-neutral canonical messages exchanged with Color Service.

Concrete adapters map a vendor payload onto these; the ERP core depends only on
these shapes, never on a vendor protocol.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


@dataclass
class DoseOrderMaterial:
    material_code: str
    target_qty: Decimal
    unit: str = "KG"
    dosing_sequence: int = 1
    is_dye: bool = False


@dataclass
class DoseOrder:
    """ERP -> Color Service: what to dispense for one bath."""

    batch_code: str
    bath_code: str
    machine_code: str
    fabric_kg: Decimal
    shade: str | None
    recipe_code: str | None
    recipe_revision: int | None
    materials: list[DoseOrderMaterial] = field(default_factory=list)


@dataclass
class DispenseResult:
    """Color Service -> ERP: one actual dispensing event for one material."""

    external_txn_id: str          # idempotency key
    bath_code: str
    material_code: str
    target_weight: Decimal
    actual_weight: Decimal
    unit: str = "KG"
    dosing_status: str = "OK"     # OK / FAILED / REPEATED / ADDITIONAL
    is_correction: bool = False
    chemical_lot: str | None = None   # supplier/internal lot reference
    operator: str | None = None
    scale_id: str | None = None
    device_code: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
