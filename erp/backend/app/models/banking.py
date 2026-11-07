"""Bank statement import + reconciliation models."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Uuid, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.types import Money
from app.models.base import AuditMixin, Base


class BankStatementLine(AuditMixin, Base):
    """One line from an imported bank statement.

    ``amount`` is signed: positive = money into the bank (credit/deposit),
    negative = money out (debit/withdrawal). ``import_ref`` makes re-importing
    the same file idempotent.
    """

    __tablename__ = "bank_statement_lines"
    __table_args__ = (
        UniqueConstraint("company_id", "bank_account_id", "import_ref", name="uq_bank_stmt_line"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    bank_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_accounts.id"), index=True)
    txn_date: Mapped[date] = mapped_column(Date, index=True)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    amount: Mapped[object] = mapped_column(Money, default=0)
    import_ref: Mapped[str] = mapped_column(String(120), index=True)
    is_reconciled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    matched_journal_line_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class BankReconciliation(AuditMixin, Base):
    """A saved reconciliation run for a bank account as of a date."""

    __tablename__ = "bank_reconciliations"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    bank_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bank_accounts.id"), index=True)
    as_of: Mapped[date] = mapped_column(Date)
    book_balance: Mapped[object] = mapped_column(Money, default=0)
    statement_balance: Mapped[object] = mapped_column(Money, default=0)
    matched_count: Mapped[int] = mapped_column(default=0)
    unmatched_statement_count: Mapped[int] = mapped_column(default=0)
    unmatched_book_count: Mapped[int] = mapped_column(default=0)
    is_reconciled: Mapped[bool] = mapped_column(Boolean, default=False)
