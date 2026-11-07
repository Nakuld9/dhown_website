"""Double-entry posting engine.

The single sanctioned path for writing to the ledger. It guarantees the
non-negotiable accounting invariants:

* debits == credits on every posted voucher (else nothing commits);
* each line is one-sided (debit XOR credit);
* a posting_reference posts at most once (idempotency);
* postings land only in OPEN periods and on postable (non-group) accounts;
* posted vouchers are immutable - corrections flow through ``reverse_voucher``.

All arithmetic is ``decimal.Decimal``; amounts are quantised to the money scale.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ledger_guard import ALLOW_REVERSAL_KEY
from app.core.types import MONEY_SCALE, quantize
from app.models.accounting import (
    AccountingPeriod,
    ChartOfAccount,
    JournalLine,
    PeriodStatus,
    Voucher,
    VoucherStatus,
    VoucherType,
)
from app.services import audit as audit_service
from app.services.sequences import next_document_number

ZERO = quantize(0, MONEY_SCALE)


class PostingError(Exception):
    """Base class for posting failures."""


class UnbalancedVoucherError(PostingError):
    pass


class ClosedPeriodError(PostingError):
    pass


class AccountNotPostableError(PostingError):
    pass


class VoucherConfigError(PostingError):
    pass


@dataclass
class PostingLine:
    account_code: str
    debit: object = 0
    credit: object = 0
    narration: str | None = None
    cost_centre_id: uuid.UUID | None = None
    party_type: str | None = None
    party_id: uuid.UUID | None = None


@dataclass
class PostingRequest:
    company_id: uuid.UUID
    voucher_type_code: str
    voucher_date: date
    posting_reference: str
    lines: list[PostingLine]
    narration: str | None = None
    branch_id: uuid.UUID | None = None
    source_module: str | None = None
    source_id: str | None = None
    created_by: uuid.UUID | None = None
    approved_by: uuid.UUID | None = None
    actor_name: str | None = None
    extra: dict = field(default_factory=dict)


def fiscal_year_for(d: date, start_month: int = 4) -> str:
    start = d.year if d.month >= start_month else d.year - 1
    return f"{start}-{start + 1}"


def resolve_period(db: Session, company_id: uuid.UUID, d: date) -> AccountingPeriod:
    period = db.execute(
        select(AccountingPeriod).where(
            AccountingPeriod.company_id == company_id,
            AccountingPeriod.start_date <= d,
            AccountingPeriod.end_date >= d,
        )
    ).scalar_one_or_none()
    if period is None:
        raise ClosedPeriodError(f"No accounting period defined for {d.isoformat()}.")
    if PeriodStatus(period.status) == PeriodStatus.CLOSED:
        raise ClosedPeriodError(f"Accounting period {period.code} is closed.")
    return period


def _get_postable_account(db: Session, company_id: uuid.UUID, code: str) -> ChartOfAccount:
    acct = db.execute(
        select(ChartOfAccount).where(
            ChartOfAccount.company_id == company_id, ChartOfAccount.code == code
        )
    ).scalar_one_or_none()
    if acct is None:
        raise AccountNotPostableError(f"Account code '{code}' not found.")
    if acct.is_group or not acct.allow_posting:
        raise AccountNotPostableError(f"Account '{code}' is a group/header and cannot receive postings.")
    if not acct.is_active:
        raise AccountNotPostableError(f"Account '{code}' is inactive.")
    return acct


def _get_voucher_type(db: Session, code: str) -> VoucherType:
    vt = db.execute(select(VoucherType).where(VoucherType.code == code)).scalar_one_or_none()
    if vt is None:
        raise VoucherConfigError(f"Voucher type '{code}' is not configured.")
    return vt


def find_existing(db: Session, company_id: uuid.UUID, posting_reference: str) -> Voucher | None:
    return db.execute(
        select(Voucher).where(
            Voucher.company_id == company_id, Voucher.posting_reference == posting_reference
        )
    ).scalar_one_or_none()


def post_voucher(db: Session, req: PostingRequest) -> Voucher:
    """Validate and post a balanced voucher. Idempotent on posting_reference."""
    # --- idempotency: never post the same source event twice ---
    existing = find_existing(db, req.company_id, req.posting_reference)
    if existing is not None:
        return existing

    if len(req.lines) < 2:
        raise UnbalancedVoucherError("A voucher needs at least two lines.")

    total_debit = ZERO
    total_credit = ZERO
    prepared: list[tuple[PostingLine, ChartOfAccount, object, object]] = []

    for ln in req.lines:
        debit = quantize(ln.debit or 0, MONEY_SCALE)
        credit = quantize(ln.credit or 0, MONEY_SCALE)
        if debit < ZERO or credit < ZERO:
            raise UnbalancedVoucherError("Line amounts cannot be negative.")
        if (debit > ZERO) == (credit > ZERO):
            raise UnbalancedVoucherError(
                "Each line must have exactly one of debit or credit greater than zero."
            )
        acct = _get_postable_account(db, req.company_id, ln.account_code)
        if acct.requires_cost_centre and ln.cost_centre_id is None:
            raise VoucherConfigError(f"Account '{ln.account_code}' requires a cost centre.")
        total_debit += debit
        total_credit += credit
        prepared.append((ln, acct, debit, credit))

    if total_debit != total_credit:
        raise UnbalancedVoucherError(
            f"Voucher is unbalanced: debit {total_debit} != credit {total_credit}."
        )
    if total_debit == ZERO:
        raise UnbalancedVoucherError("Voucher total cannot be zero.")

    period = resolve_period(db, req.company_id, req.voucher_date)
    vt = _get_voucher_type(db, req.voucher_type_code)
    fy = fiscal_year_for(req.voucher_date)
    number = next_document_number(
        db, company_id=req.company_id, doc_type=vt.code, fiscal_year=fy, prefix=vt.prefix
    )

    voucher = Voucher(
        company_id=req.company_id,
        branch_id=req.branch_id,
        voucher_type_id=vt.id,
        period_id=period.id,
        number=number,
        voucher_date=req.voucher_date,
        narration=req.narration,
        status=VoucherStatus.POSTED,
        source_module=req.source_module,
        source_id=req.source_id,
        posting_reference=req.posting_reference,
        approved_by=req.approved_by,
        posted_at=req.voucher_date,
        total_debit=total_debit,
        total_credit=total_credit,
        created_by=req.created_by,
    )
    for i, (ln, acct, debit, credit) in enumerate(prepared, start=1):
        voucher.lines.append(
            JournalLine(
                line_no=i,
                account_id=acct.id,
                cost_centre_id=ln.cost_centre_id,
                debit=debit,
                credit=credit,
                narration=ln.narration,
                party_type=ln.party_type,
                party_id=ln.party_id,
            )
        )
    db.add(voucher)
    db.flush()

    audit_service.record_audit(
        db,
        action="POST",
        entity="voucher",
        entity_id=str(voucher.id),
        actor_id=req.created_by,
        actor_name=req.actor_name,
        detail={
            "number": number,
            "posting_reference": req.posting_reference,
            "total_debit": str(total_debit),
            "total_credit": str(total_credit),
            "source": f"{req.source_module}:{req.source_id}",
        },
    )
    return voucher


def reverse_voucher(
    db: Session,
    voucher_id: uuid.UUID,
    *,
    reason: str,
    created_by: uuid.UUID | None = None,
    reversal_date: date | None = None,
    actor_name: str | None = None,
) -> Voucher:
    """Create a REVERSAL voucher that cancels a posted voucher (rule #4)."""
    original = db.get(Voucher, voucher_id)
    if original is None:
        raise PostingError("Voucher to reverse not found.")
    if VoucherStatus(original.status) != VoucherStatus.POSTED:
        raise PostingError("Only POSTED vouchers can be reversed.")

    rdate = reversal_date or original.voucher_date
    period = resolve_period(db, original.company_id, rdate)
    fy = fiscal_year_for(rdate)
    vt = db.get(VoucherType, original.voucher_type_id)
    number = next_document_number(
        db, company_id=original.company_id, doc_type=vt.code, fiscal_year=fy, prefix=vt.prefix
    )

    reversal = Voucher(
        company_id=original.company_id,
        branch_id=original.branch_id,
        voucher_type_id=original.voucher_type_id,
        period_id=period.id,
        number=number,
        voucher_date=rdate,
        narration=f"Reversal of {original.number}: {reason}",
        status=VoucherStatus.REVERSAL,
        source_module=original.source_module,
        source_id=original.source_id,
        posting_reference=f"REVERSAL:{original.posting_reference}",
        reversal_of_id=original.id,
        posted_at=rdate,
        total_debit=original.total_credit,
        total_credit=original.total_debit,
        created_by=created_by,
    )
    for i, line in enumerate(original.lines, start=1):
        reversal.lines.append(
            JournalLine(
                line_no=i,
                account_id=line.account_id,
                cost_centre_id=line.cost_centre_id,
                debit=line.credit,   # swap
                credit=line.debit,
                narration=f"Reversal: {line.narration or ''}".strip(),
                party_type=line.party_type,
                party_id=line.party_id,
            )
        )
    db.add(reversal)

    # Sanction the one allowed status change on the original.
    db.info[ALLOW_REVERSAL_KEY] = True
    try:
        original.status = VoucherStatus.REVERSED
        db.flush()
    finally:
        db.info.pop(ALLOW_REVERSAL_KEY, None)

    audit_service.record_audit(
        db,
        action="REVERSE",
        entity="voucher",
        entity_id=str(original.id),
        actor_id=created_by,
        actor_name=actor_name,
        detail={"reversal_voucher": number, "reason": reason},
    )
    return reversal
