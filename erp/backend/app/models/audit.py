"""Control models: immutable audit log and document number sequences."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, Uuid, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuditLog(Base):
    """Append-only audit trail. Rows are written, never updated or deleted."""

    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    actor_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    action: Mapped[str] = mapped_column(String(60), index=True)       # CREATE/UPDATE/POST/REVERSE/LOGIN
    entity: Mapped[str] = mapped_column(String(60), index=True)       # table / domain object
    entity_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)   # JSON string of before/after


class DocumentSequence(Base):
    """Per-company, per-document-type running number with a prefix.

    Used to generate voucher numbers, GRN numbers, invoice numbers, batch IDs
    etc. deterministically and without gaps under a transaction.
    """

    __tablename__ = "document_sequences"
    __table_args__ = (
        UniqueConstraint("company_id", "doc_type", "fiscal_year", name="uq_docseq"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    doc_type: Mapped[str] = mapped_column(String(40), index=True)
    fiscal_year: Mapped[str] = mapped_column(String(9))
    prefix: Mapped[str] = mapped_column(String(20), default="")
    next_number: Mapped[int] = mapped_column(Integer, default=1)
    padding: Mapped[int] = mapped_column(Integer, default=5)
