"""Declarative base and shared mixins.

Every row carries a UUID primary key (prompt requirement: UUID identifiers) and
creation/update timestamps. Business masters additionally mix in company scoping
for multi-company isolation (accounting rule #20).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import DeclarativeBase, mapped_column


class Base(DeclarativeBase):
    pass


def _uuid_pk():
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UUIDMixin:
    id = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class AuditMixin(TimestampMixin):
    """Tracks which user created/updated a record (soft audit at row level).

    Immutable financial records additionally get full audit_log rows; this mixin
    is the lightweight per-row trail required on every master.
    """

    created_by = mapped_column(Uuid, nullable=True)
    updated_by = mapped_column(Uuid, nullable=True)


class CompanyScopedMixin(AuditMixin):
    """Rows that belong to a specific company for multi-company isolation."""

    @staticmethod
    def company_fk():
        return mapped_column(Uuid, ForeignKey("companies.id"), nullable=False, index=True)


def code_column(length: int = 40, unique: bool = False):
    return mapped_column(String(length), nullable=False, unique=unique, index=True)
