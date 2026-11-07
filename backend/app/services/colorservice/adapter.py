"""Color Service adapter protocol and a development simulator.

The simulator produces deterministic ``DispenseResult``s so idempotency/replay
tests are stable. Actuals are jittered slightly off target to exercise variance
handling. It is never used when a verified vendor adapter is configured.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Protocol

from app.core.types import QTY_SCALE, quantize
from app.services.colorservice.schemas import DispenseResult, DoseOrder


class SendAck:
    def __init__(self, accepted: bool, ref: str, message: str = ""):
        self.accepted = accepted
        self.ref = ref
        self.message = message


class ColorServiceAdapter(Protocol):
    def send_dose_order(self, order: DoseOrder) -> SendAck: ...
    def fetch_results(self, order: DoseOrder) -> list[DispenseResult]: ...


class ColorServiceSimulator:
    """Non-production adapter. Echoes dose orders back as dispensing results."""

    def __init__(self, *, variance_pct: str = "0.5", lot_by_material: dict[str, str] | None = None):
        self.variance = Decimal("1") + Decimal(variance_pct) / Decimal("100")
        self.lot_by_material = lot_by_material or {}
        self._sent: dict[str, DoseOrder] = {}

    def send_dose_order(self, order: DoseOrder) -> SendAck:
        self._sent[order.bath_code] = order
        return SendAck(True, ref=f"SIM:{order.bath_code}", message="accepted by simulator")

    def fetch_results(self, order: DoseOrder) -> list[DispenseResult]:
        now = datetime.now(timezone.utc)
        results: list[DispenseResult] = []
        for mat in order.materials:
            actual = quantize(Decimal(str(mat.target_qty)) * self.variance, QTY_SCALE)
            results.append(DispenseResult(
                external_txn_id=f"{order.bath_code}:{mat.material_code}:{mat.dosing_sequence}",
                bath_code=order.bath_code, material_code=mat.material_code,
                target_weight=quantize(mat.target_qty, QTY_SCALE), actual_weight=actual,
                unit=mat.unit, dosing_status="OK",
                chemical_lot=self.lot_by_material.get(mat.material_code),
                operator="SIM-OP", scale_id="SIM-SCALE-1", device_code="SIM-DEV-1",
                started_at=now, completed_at=now,
            ))
        return results

    def make_correction(
        self, order: DoseOrder, material_code: str, qty, *, seq: int = 99
    ) -> DispenseResult:
        """Emit an additional/correction dose for one material (brief TEST 10)."""
        now = datetime.now(timezone.utc)
        return DispenseResult(
            external_txn_id=f"{order.bath_code}:{material_code}:correction:{seq}",
            bath_code=order.bath_code, material_code=material_code,
            target_weight=quantize(qty, QTY_SCALE), actual_weight=quantize(qty, QTY_SCALE),
            unit="KG", dosing_status="ADDITIONAL", is_correction=True,
            chemical_lot=self.lot_by_material.get(material_code),
            operator="SIM-OP", scale_id="SIM-SCALE-1", device_code="SIM-DEV-1",
            started_at=now, completed_at=now,
        )
