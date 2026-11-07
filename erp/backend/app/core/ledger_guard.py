"""Immutable-ledger enforcement.

Accounting rules #3 and #4: posted journal entries cannot be deleted, and
posted vouchers cannot be edited - corrections must go through a reversal.
We enforce this at the SQLAlchemy ``Session`` level so it holds no matter which
code path tries the mutation.

Newly created rows (``session.new``) are never blocked; the guard only fires on
already-committed posted data that a later unit of work tries to change.
"""
from __future__ import annotations

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.accounting import JournalLine, Voucher, VoucherStatus

ALLOW_REVERSAL_KEY = "_allow_reversal_status_change"

_LOCKED_STATUSES = {VoucherStatus.POSTED, VoucherStatus.REVERSED, VoucherStatus.REVERSAL}
_FROZEN_VOUCHER_FIELDS = ("total_debit", "total_credit", "voucher_date", "posting_reference", "number")
_FROZEN_LINE_FIELDS = ("debit", "credit", "account_id")


class ImmutableLedgerError(Exception):
    """Raised when code attempts to mutate a posted ledger record."""


def _coerce_status(value) -> VoucherStatus:
    return value if isinstance(value, VoucherStatus) else VoucherStatus(value)


@event.listens_for(Session, "before_flush")
def _enforce_immutable_ledger(session: Session, flush_context, instances) -> None:
    # Deletions: no posted voucher or any journal line may be removed.
    for obj in session.deleted:
        if isinstance(obj, JournalLine):
            raise ImmutableLedgerError("Posted journal lines cannot be deleted; use a reversal voucher.")
        if isinstance(obj, Voucher) and _coerce_status(obj.status) in _LOCKED_STATUSES:
            raise ImmutableLedgerError("Posted vouchers cannot be deleted; use a reversal voucher.")

    allow_reversal = bool(session.info.get(ALLOW_REVERSAL_KEY))

    for obj in session.dirty:
        if not session.is_modified(obj, include_collections=False):
            continue
        state = inspect(obj)

        if isinstance(obj, JournalLine):
            voucher = obj.voucher
            if voucher is not None and _coerce_status(voucher.status) in _LOCKED_STATUSES:
                for field in _FROZEN_LINE_FIELDS:
                    if state.attrs[field].history.has_changes():
                        raise ImmutableLedgerError(
                            f"Posted journal line field '{field}' is immutable."
                        )

        elif isinstance(obj, Voucher):
            status_hist = state.attrs["status"].history
            old_status = (
                _coerce_status(status_hist.deleted[0])
                if status_hist.has_changes() and status_hist.deleted
                else _coerce_status(obj.status)
            )
            if old_status in _LOCKED_STATUSES:
                # Freeze financial fields.
                for field in _FROZEN_VOUCHER_FIELDS:
                    if state.attrs[field].history.has_changes():
                        raise ImmutableLedgerError(
                            f"Posted voucher field '{field}' is immutable."
                        )
                # Only sanctioned reversal may move POSTED -> REVERSED.
                if status_hist.has_changes():
                    new_status = _coerce_status(obj.status)
                    sanctioned = (
                        old_status == VoucherStatus.POSTED
                        and new_status == VoucherStatus.REVERSED
                        and allow_reversal
                    )
                    if not sanctioned:
                        raise ImmutableLedgerError(
                            "Posted voucher status change is not permitted outside a reversal."
                        )
