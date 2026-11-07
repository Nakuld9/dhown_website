"""Double-entry accounting models.

This is the CRITICAL module. Design invariants enforced here and in the posting
engine (app/services/accounting/posting_engine.py):

* A posted voucher's debit total always equals its credit total.
* Posted vouchers/journal lines are never edited or deleted - corrections go
  through reversal vouchers.
* Every voucher carries a unique ``posting_reference`` so the same source event
  cannot post twice (idempotency).
* Monetary amounts use the Decimal-safe ``Money`` column type (never float).
"""
from __future__ import annotations

import enum
import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.types import Money
from app.models.base import AuditMixin, Base, TimestampMixin


class AccountType(str, enum.Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


# Normal balance side per account type. Assets/expenses increase on debit;
# liabilities/equity/income increase on credit.
NORMAL_SIDE: dict[AccountType, str] = {
    AccountType.ASSET: "DEBIT",
    AccountType.EXPENSE: "DEBIT",
    AccountType.LIABILITY: "CREDIT",
    AccountType.EQUITY: "CREDIT",
    AccountType.INCOME: "CREDIT",
}


class VoucherStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    REVERSED = "REVERSED"      # a voucher that has been cancelled by a reversal
    REVERSAL = "REVERSAL"      # the voucher that performs a reversal


class PeriodStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class ChartOfAccount(AuditMixin, Base):
    __tablename__ = "chart_of_accounts"
    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_coa_company_code"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(200))
    account_type: Mapped[AccountType] = mapped_column(String(20))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("chart_of_accounts.id"), nullable=True)
    # A "group" account is a heading that cannot receive postings directly.
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_posting: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Control-account flags used by sub-ledgers / reconciliation.
    is_bank: Mapped[bool] = mapped_column(Boolean, default=False)
    is_cash: Mapped[bool] = mapped_column(Boolean, default=False)
    is_control: Mapped[bool] = mapped_column(Boolean, default=False)  # AR/AP/inventory control
    requires_cost_centre: Mapped[bool] = mapped_column(Boolean, default=False)

    children: Mapped[list["ChartOfAccount"]] = relationship()

    @property
    def normal_side(self) -> str:
        return NORMAL_SIDE[AccountType(self.account_type)]


class AccountingPeriod(AuditMixin, Base):
    __tablename__ = "accounting_periods"
    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_period_company_code"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(20), index=True)   # e.g. "2026-04"
    name: Mapped[str] = mapped_column(String(100))
    fiscal_year: Mapped[str] = mapped_column(String(9))          # e.g. "2026-2027"
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[PeriodStatus] = mapped_column(String(10), default=PeriodStatus.OPEN)


class VoucherType(TimestampMixin, Base):
    __tablename__ = "voucher_types"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    prefix: Mapped[str] = mapped_column(String(10))
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)


class Voucher(AuditMixin, Base):
    __tablename__ = "vouchers"
    __table_args__ = (
        # Idempotency: one source event -> at most one voucher.
        UniqueConstraint("company_id", "posting_reference", name="uq_voucher_posting_ref"),
        UniqueConstraint("company_id", "number", name="uq_voucher_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    voucher_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("voucher_types.id"))
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounting_periods.id"))

    number: Mapped[str] = mapped_column(String(40), index=True)
    voucher_date: Mapped[date] = mapped_column(Date, index=True)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[VoucherStatus] = mapped_column(String(10), default=VoucherStatus.DRAFT, index=True)

    # Traceability back to the business event that generated this voucher.
    source_module: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    posting_reference: Mapped[str] = mapped_column(String(120), index=True)

    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vouchers.id"), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    posted_at: Mapped[date | None] = mapped_column(Date, nullable=True)

    total_debit: Mapped[object] = mapped_column(Money, default=0)
    total_credit: Mapped[object] = mapped_column(Money, default=0)

    lines: Mapped[list["JournalLine"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan", order_by="JournalLine.line_no"
    )


class JournalLine(TimestampMixin, Base):
    __tablename__ = "journal_lines"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    voucher_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vouchers.id", ondelete="CASCADE"), index=True)
    line_no: Mapped[int] = mapped_column(Integer)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chart_of_accounts.id"), index=True)
    cost_centre_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("cost_centres.id"), nullable=True)

    debit: Mapped[object] = mapped_column(Money, default=0)
    credit: Mapped[object] = mapped_column(Money, default=0)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Sub-ledger linkage (customer / supplier / inventory item) for drill-down.
    party_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    party_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    voucher: Mapped[Voucher] = relationship(back_populates="lines")


class PostingRule(TimestampMixin, Base):
    """Configurable mapping from a business event type to accounting accounts.

    The posting engine resolves account codes for each event from these rows so
    the chart of accounts and GST behaviour stay configurable, not hardcoded.
    """

    __tablename__ = "accounting_posting_rules"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    role: Mapped[str] = mapped_column(String(60))   # semantic slot, e.g. "inventory", "input_gst"
    account_code: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
