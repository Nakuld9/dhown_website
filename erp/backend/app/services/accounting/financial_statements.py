"""Financial statements derived from the posted ledger.

Profit & Loss, Balance Sheet, Cash Flow and debtor/creditor ageing. Everything
is computed from posted journal lines (via the trial balance), so the statements
are always consistent with the immutable ledger. The Balance Sheet folds the
period's computed profit into equity so it balances without a posted year-end
closing entry.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.types import MONEY_SCALE, quantize
from app.models.accounting import ChartOfAccount, JournalLine, Voucher, VoucherStatus
from app.services.accounting.trial_balance import trial_balance

ZERO = quantize(0, MONEY_SCALE)
_POSTED = [s.value for s in (VoucherStatus.POSTED, VoucherStatus.REVERSED, VoucherStatus.REVERSAL)]


def _fy_start(d: date, start_month: int = 4) -> date:
    year = d.year if d.month >= start_month else d.year - 1
    return date(year, start_month, 1)


# --------------------------- Profit & Loss ---------------------------------

def profit_and_loss(db: Session, company_id: uuid.UUID, date_from: date, date_to: date) -> dict:
    tb = trial_balance(db, company_id, date_from=date_from, date_to=date_to)
    income, direct, indirect = [], [], []
    rev_total = direct_total = indirect_total = ZERO

    for row in tb["rows"]:
        period_net = row["period_debit"] - row["period_credit"]  # debit-positive
        if row["account_type"] == "INCOME":
            amount = -period_net  # income is credit-natural
            if amount != ZERO:
                income.append({"account_code": row["account_code"], "name": row["account_name"], "amount": amount})
                rev_total += amount
        elif row["account_type"] == "EXPENSE":
            amount = period_net
            if amount == ZERO:
                continue
            entry = {"account_code": row["account_code"], "name": row["account_name"], "amount": amount}
            if row["account_code"].startswith("5"):
                direct.append(entry); direct_total += amount
            else:
                indirect.append(entry); indirect_total += amount

    gross_profit = rev_total - direct_total
    net_profit = gross_profit - indirect_total
    return {
        "date_from": date_from, "date_to": date_to,
        "income": income, "direct_expenses": direct, "indirect_expenses": indirect,
        "revenue_total": rev_total, "direct_expense_total": direct_total,
        "indirect_expense_total": indirect_total,
        "gross_profit": gross_profit, "net_profit": net_profit,
    }


# --------------------------- Balance Sheet ---------------------------------

def balance_sheet(db: Session, company_id: uuid.UUID, as_of: date,
                  *, fy_start: date | None = None) -> dict:
    fy_start = fy_start or _fy_start(as_of)
    tb = trial_balance(db, company_id, date_from=None, date_to=as_of)

    assets, liabilities, equity = [], [], []
    assets_total = liabilities_total = equity_total = ZERO

    for row in tb["rows"]:
        net_debit = row["closing_debit"] - row["closing_credit"]
        t = row["account_type"]
        if t == "ASSET":
            if net_debit != ZERO:
                assets.append({"account_code": row["account_code"], "name": row["account_name"], "amount": net_debit})
                assets_total += net_debit
        elif t == "LIABILITY":
            amt = -net_debit
            if amt != ZERO:
                liabilities.append({"account_code": row["account_code"], "name": row["account_name"], "amount": amt})
                liabilities_total += amt
        elif t == "EQUITY":
            amt = -net_debit
            if amt != ZERO:
                equity.append({"account_code": row["account_code"], "name": row["account_name"], "amount": amt})
                equity_total += amt

    # Current-year earnings (not yet closed to retained earnings) belong in equity.
    pnl = profit_and_loss(db, company_id, fy_start, as_of)
    current_profit = pnl["net_profit"]
    equity.append({"account_code": "3040", "name": "Current Year Profit (computed)", "amount": current_profit})
    equity_total += current_profit

    return {
        "as_of": as_of,
        "assets": assets, "liabilities": liabilities, "equity": equity,
        "assets_total": assets_total, "liabilities_total": liabilities_total,
        "equity_total": equity_total,
        "liabilities_and_equity_total": liabilities_total + equity_total,
        "is_balanced": assets_total == liabilities_total + equity_total,
    }


# ----------------------------- Cash Flow -----------------------------------

def _classify(code: str) -> str:
    if code.startswith("15"):
        return "investing"
    if code.startswith("3") or code.startswith("25") or code == "2070":
        return "financing"
    return "operating"


def cash_flow(db: Session, company_id: uuid.UUID, date_from: date, date_to: date) -> dict:
    cash_accts = db.execute(
        select(ChartOfAccount).where(
            ChartOfAccount.company_id == company_id,
            (ChartOfAccount.is_cash.is_(True)) | (ChartOfAccount.is_bank.is_(True)),
        )
    ).scalars().all()
    cash_ids = {a.id for a in cash_accts}
    code_by_id = {
        a.id: a.code
        for a in db.execute(select(ChartOfAccount).where(ChartOfAccount.company_id == company_id)).scalars()
    }

    # Opening cash balance (before the window).
    opening = ZERO
    for line, voucher in db.execute(
        select(JournalLine, Voucher).join(Voucher, JournalLine.voucher_id == Voucher.id).where(
            Voucher.company_id == company_id, Voucher.status.in_(_POSTED),
            JournalLine.account_id.in_(cash_ids), Voucher.voucher_date < date_from,
        )
    ):
        opening += (line.debit or ZERO) - (line.credit or ZERO)

    buckets = {"operating": ZERO, "investing": ZERO, "financing": ZERO}
    # Group period cash lines by voucher so we can read their counter accounts.
    by_voucher: dict[uuid.UUID, Decimal] = {}
    voucher_lines: dict[uuid.UUID, list[JournalLine]] = {}
    for line, voucher in db.execute(
        select(JournalLine, Voucher).join(Voucher, JournalLine.voucher_id == Voucher.id).where(
            Voucher.company_id == company_id, Voucher.status.in_(_POSTED),
            Voucher.voucher_date >= date_from, Voucher.voucher_date <= date_to,
        )
    ):
        voucher_lines.setdefault(voucher.id, []).append(line)
        if line.account_id in cash_ids:
            by_voucher[voucher.id] = by_voucher.get(voucher.id, ZERO) + (line.debit or ZERO) - (line.credit or ZERO)

    net_change = ZERO
    for vid, cash_delta in by_voucher.items():
        if cash_delta == ZERO:
            continue
        net_change += cash_delta
        counters = [l for l in voucher_lines[vid] if l.account_id not in cash_ids]
        if not counters:
            buckets["operating"] += cash_delta  # pure cash<->cash transfer (nets out overall)
            continue
        dominant = max(counters, key=lambda l: (l.debit or ZERO) + (l.credit or ZERO))
        buckets[_classify(code_by_id.get(dominant.account_id, ""))] += cash_delta

    closing = opening + net_change
    return {
        "date_from": date_from, "date_to": date_to,
        "opening_cash": opening, "closing_cash": closing, "net_change": net_change,
        "operating": buckets["operating"], "investing": buckets["investing"],
        "financing": buckets["financing"],
        "is_reconciled": net_change == buckets["operating"] + buckets["investing"] + buckets["financing"],
    }


# ----------------------------- Ageing --------------------------------------

def _ageing(db: Session, company_id: uuid.UUID, account_code: str, party_type: str,
            as_of: date, invoice_on: str) -> dict:
    """FIFO ageing of open items on a control account.

    invoice_on='debit' for debtors (AR: invoices debit, receipts credit);
    'credit' for creditors (AP: invoices credit, payments debit).
    """
    acct = db.execute(
        select(ChartOfAccount).where(ChartOfAccount.company_id == company_id, ChartOfAccount.code == account_code)
    ).scalar_one_or_none()
    if acct is None:
        return {"parties": [], "total": ZERO}

    rows = db.execute(
        select(JournalLine, Voucher).join(Voucher, JournalLine.voucher_id == Voucher.id).where(
            Voucher.company_id == company_id, Voucher.status.in_(_POSTED),
            JournalLine.account_id == acct.id, JournalLine.party_type == party_type,
            Voucher.voucher_date <= as_of,
        ).order_by(Voucher.voucher_date, Voucher.number)
    ).all()

    per_party: dict[uuid.UUID, dict] = {}
    for line, voucher in rows:
        p = per_party.setdefault(line.party_id, {"open": [], "payments": ZERO})
        inv_amt = (line.debit if invoice_on == "debit" else line.credit) or ZERO
        pay_amt = (line.credit if invoice_on == "debit" else line.debit) or ZERO
        if inv_amt > ZERO:
            p["open"].append([voucher.voucher_date, inv_amt])
        if pay_amt > ZERO:
            p["payments"] += pay_amt

    parties = []
    grand_total = ZERO
    for party_id, data in per_party.items():
        pay = data["payments"]
        # Apply payments FIFO to oldest invoices.
        for item in data["open"]:
            if pay <= ZERO:
                break
            applied = item[1] if item[1] <= pay else pay
            item[1] -= applied
            pay -= applied
        buckets = {"0-30": ZERO, "31-60": ZERO, "61-90": ZERO, "90+": ZERO}
        outstanding = ZERO
        for inv_date, amt in data["open"]:
            if amt <= ZERO:
                continue
            age = (as_of - inv_date).days
            key = "0-30" if age <= 30 else "31-60" if age <= 60 else "61-90" if age <= 90 else "90+"
            buckets[key] += amt
            outstanding += amt
        if outstanding != ZERO or pay != ZERO:
            parties.append({"party_id": str(party_id), "outstanding": outstanding,
                            "unapplied_payment": pay, **buckets})
            grand_total += outstanding
    return {"as_of": as_of, "parties": parties, "total": grand_total}


def debtors_ageing(db: Session, company_id: uuid.UUID, as_of: date) -> dict:
    return _ageing(db, company_id, "1040", "customer", as_of, invoice_on="debit")


def creditors_ageing(db: Session, company_id: uuid.UUID, as_of: date) -> dict:
    return _ageing(db, company_id, "2010", "supplier", as_of, invoice_on="credit")
