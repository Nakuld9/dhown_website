"""Weighing-scale and knitting-machine integration.

Vendor-neutral canonical messages + an adapter protocol + a development
simulator, mirroring the Color Service pattern. Ingest is idempotent on each
message's external id, so re-delivery (reconnect/replay) never duplicates.
PENDING VENDOR VERIFICATION until a concrete device adapter is validated.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.types import MONEY_SCALE, QTY_SCALE, quantize
from app.models.hardware import KnittingMachineLog, MachineStatus, ScaleReading, WeighingScale
from app.models.manufacturing import FabricRoll
from app.models.masters import Machine


# ------------------------------ messages -----------------------------------

@dataclass
class ScaleReadingMsg:
    external_reading_id: str
    scale_code: str
    weight: Decimal
    unit: str = "KG"
    stable: bool = True
    reference_type: str | None = None          # ROLL / BATH
    reference_id: str | None = None
    operator: str | None = None
    captured_at: datetime | None = None


@dataclass
class KnittingLogMsg:
    external_log_id: str
    machine_code: str
    status: str = "RUNNING"
    produced_kg: Decimal = Decimal("0")
    rpm: Decimal | None = None
    run_minutes: int = 0
    downtime_minutes: int = 0
    stop_reason: str | None = None
    operator: str | None = None
    log_time: datetime | None = None


# ------------------------------ adapters -----------------------------------

class WeighingScaleAdapter(Protocol):
    def fetch_readings(self) -> list[ScaleReadingMsg]: ...


class KnittingMachineAdapter(Protocol):
    def fetch_logs(self) -> list[KnittingLogMsg]: ...


class WeighingScaleSimulator:
    """Emits a stable weight reading for a roll/bath. Deterministic external id."""

    def __init__(self, scale_code: str = "SCALE-01"):
        self.scale_code = scale_code

    def read(self, weight, *, reference_type=None, reference_id=None, seq: int = 1,
             operator: str = "SIM-OP") -> ScaleReadingMsg:
        ref = reference_id or "na"
        return ScaleReadingMsg(
            external_reading_id=f"{self.scale_code}:{ref}:{seq}",
            scale_code=self.scale_code, weight=quantize(weight, QTY_SCALE), unit="KG",
            stable=True, reference_type=reference_type, reference_id=str(reference_id) if reference_id else None,
            operator=operator, captured_at=datetime.now(timezone.utc),
        )

    def fetch_readings(self) -> list[ScaleReadingMsg]:  # pragma: no cover - push model in practice
        return []


class KnittingMachineSimulator:
    """Generates monitoring samples: running production plus an occasional stop."""

    def __init__(self, machine_code: str):
        self.machine_code = machine_code

    def generate(self, samples: int = 4, *, kg_per_sample: str = "25", run_min: int = 55,
                 inject_stop_every: int = 4) -> list[KnittingLogMsg]:
        out = []
        for i in range(1, samples + 1):
            stop = inject_stop_every and (i % inject_stop_every == 0)
            out.append(KnittingLogMsg(
                external_log_id=f"{self.machine_code}:{i}",
                machine_code=self.machine_code,
                status=MachineStatus.STOPPED.value if stop else MachineStatus.RUNNING.value,
                produced_kg=Decimal("0") if stop else Decimal(kg_per_sample),
                rpm=Decimal("0") if stop else Decimal("22"),
                run_minutes=0 if stop else run_min,
                downtime_minutes=5 if stop else 0,
                stop_reason="Yarn break" if stop else None,
                operator="SIM-OP", log_time=datetime.now(timezone.utc),
            ))
        return out

    def fetch_logs(self) -> list[KnittingLogMsg]:  # pragma: no cover
        return self.generate()


# ------------------------------ ingest -------------------------------------

def _scale_by_code(db, company_id, code):
    return db.execute(select(WeighingScale).where(
        WeighingScale.company_id == company_id, WeighingScale.code == code)).scalar_one_or_none()


def ingest_scale_readings(db: Session, company_id: uuid.UUID, readings: list[ScaleReadingMsg]) -> dict:
    created = skipped = 0
    for r in readings:
        exists = db.execute(select(ScaleReading).where(
            ScaleReading.company_id == company_id,
            ScaleReading.external_reading_id == r.external_reading_id)).scalar_one_or_none()
        if exists:
            skipped += 1
            continue
        scale = _scale_by_code(db, company_id, r.scale_code)
        ref_id = uuid.UUID(r.reference_id) if r.reference_id else None
        db.add(ScaleReading(
            company_id=company_id, scale_id=scale.id if scale else None,
            external_reading_id=r.external_reading_id, weight=r.weight, unit=r.unit, stable=r.stable,
            reference_type=r.reference_type, reference_id=ref_id, operator=r.operator,
            captured_at=r.captured_at or datetime.now(timezone.utc)))
        created += 1
    db.flush()
    return {"created": created, "skipped": skipped}


def _machine_by_code(db, company_id, code):
    return db.execute(select(Machine).where(
        Machine.company_id == company_id, Machine.code == code)).scalar_one_or_none()


def ingest_knitting_logs(db: Session, company_id: uuid.UUID, logs: list[KnittingLogMsg]) -> dict:
    created = skipped = failed = 0
    for g in logs:
        exists = db.execute(select(KnittingMachineLog).where(
            KnittingMachineLog.company_id == company_id,
            KnittingMachineLog.external_log_id == g.external_log_id)).scalar_one_or_none()
        if exists:
            skipped += 1
            continue
        machine = _machine_by_code(db, company_id, g.machine_code)
        if machine is None:
            failed += 1
            continue
        db.add(KnittingMachineLog(
            company_id=company_id, machine_id=machine.id, external_log_id=g.external_log_id,
            log_time=g.log_time or datetime.now(timezone.utc), status=g.status,
            produced_kg=g.produced_kg, rpm=g.rpm, run_minutes=g.run_minutes,
            downtime_minutes=g.downtime_minutes, stop_reason=g.stop_reason, operator=g.operator))
        created += 1
    db.flush()
    return {"created": created, "skipped": skipped, "failed": failed}


# ------------------------------ summary ------------------------------------

def knitting_machine_summary(db: Session, company_id: uuid.UUID, *, machine_id=None) -> list[dict]:
    machines = db.execute(select(Machine).where(
        Machine.company_id == company_id, Machine.machine_type == "KNITTING")).scalars().all()
    rows = []
    for m in machines:
        if machine_id and m.id != machine_id:
            continue
        logs = db.execute(select(KnittingMachineLog).where(
            KnittingMachineLog.company_id == company_id,
            KnittingMachineLog.machine_id == m.id)).scalars().all()
        run = sum(l.run_minutes for l in logs)
        down = sum(l.downtime_minutes for l in logs)
        produced = sum((Decimal(str(l.produced_kg or 0)) for l in logs), Decimal("0"))
        stops = sum(1 for l in logs if l.status == MachineStatus.STOPPED.value)
        eff = quantize(Decimal(run) / Decimal(run + down) * Decimal("100"), QTY_SCALE) if (run + down) else quantize(0, QTY_SCALE)
        if logs:
            rows.append({
                "machine": m.code, "samples": len(logs), "produced_kg": quantize(produced, QTY_SCALE),
                "run_minutes": run, "downtime_minutes": down, "stops": stops, "efficiency_pct": eff,
            })
    return rows
