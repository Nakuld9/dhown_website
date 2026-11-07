"""Shop-floor hardware integration models.

Weighing scales and knitting-machine monitoring. Like the Color Service
integration these are vendor-neutral: a gateway (or the bundled simulator)
delivers readings that carry a stable external id, so re-delivery is idempotent.
``machine_process_logs`` from the brief's schema is ``KnittingMachineLog`` here.
PENDING VENDOR VERIFICATION until a concrete device adapter is validated.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.types import Quantity
from app.models.base import AuditMixin, Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MachineStatus(str, enum.Enum):
    RUNNING = "RUNNING"
    STOPPED = "STOPPED"
    IDLE = "IDLE"


class WeighingScale(AuditMixin, Base):
    __tablename__ = "weighing_scales"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    capacity_kg: Mapped[object | None] = mapped_column(Quantity, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ScaleReading(AuditMixin, Base):
    """A captured weight. Optionally tied to a roll or a dye bath for traceability."""

    __tablename__ = "scale_readings"
    __table_args__ = (UniqueConstraint("company_id", "external_reading_id", name="uq_scale_reading"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    scale_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("weighing_scales.id"), nullable=True)
    external_reading_id: Mapped[str] = mapped_column(String(80), index=True)
    weight: Mapped[object] = mapped_column(Quantity, default=0)
    unit: Mapped[str] = mapped_column(String(10), default="KG")
    stable: Mapped[bool] = mapped_column(Boolean, default=True)
    reference_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # ROLL / BATH
    reference_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    operator: Mapped[str | None] = mapped_column(String(80), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class KnittingMachineLog(AuditMixin, Base):
    """A machine-monitoring sample: status, production, speed, stop reason."""

    __tablename__ = "machine_process_logs"
    __table_args__ = (UniqueConstraint("company_id", "external_log_id", name="uq_machine_log"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    machine_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("machines.id"), index=True)
    external_log_id: Mapped[str] = mapped_column(String(80), index=True)
    log_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    status: Mapped[MachineStatus] = mapped_column(String(10), default=MachineStatus.RUNNING)
    produced_kg: Mapped[object] = mapped_column(Quantity, default=0)
    rpm: Mapped[object | None] = mapped_column(Quantity, nullable=True)
    run_minutes: Mapped[int] = mapped_column(Integer, default=0)
    downtime_minutes: Mapped[int] = mapped_column(Integer, default=0)
    stop_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    operator: Mapped[str | None] = mapped_column(String(80), nullable=True)
