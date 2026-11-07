"""Stage 7 banking: receipts/payments, CSV import, reconciliation (TEST 14)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services import banking

CSV = """date,description,reference,amount
2026-11-05,NEFT from Fashion House,RV001,236000
2026-11-06,RTGS to Acme Chemicals,PV001,-118000
2026-11-06,Monthly bank charges,CHG,-1000
"""


def _receipt_and_payment(db, demo):
    banking.customer_receipt(db, company_id=demo["company_id"], bank_account_id=demo["bank_account_id"],
                             customer_id=demo["customer_id"], amount=Decimal("236000"),
                             vdate=date(2026, 11, 5), ref="RV:RCPT-1")
    banking.supplier_payment(db, company_id=demo["company_id"], bank_account_id=demo["bank_account_id"],
                             supplier_id=demo["supplier_id"], amount=Decimal("118000"),
                             vdate=date(2026, 11, 6), ref="PV:PAY-1")
    db.commit()


def test_receipt_and_payment_post_balanced(db, demo):
    _receipt_and_payment(db, demo)
    # Bank ledger balance = 236000 - 118000 = 118000.
    from app.services.accounting.trial_balance import account_ledger
    led = account_ledger(db, demo["company_id"], "1020")
    assert led["closing_balance"] == Decimal("118000.00")


def test_csv_import_is_idempotent(db, demo):
    r1 = banking.import_statement_csv(db, company_id=demo["company_id"],
                                      bank_account_id=demo["bank_account_id"], csv_text=CSV)
    db.commit()
    assert r1["created"] == 3
    r2 = banking.import_statement_csv(db, company_id=demo["company_id"],
                                      bank_account_id=demo["bank_account_id"], csv_text=CSV)
    db.commit()
    assert r2["created"] == 0 and r2["skipped"] == 3


def test_reconciliation_flags_unbooked_charge_then_reconciles(db, demo):
    _receipt_and_payment(db, demo)
    banking.import_statement_csv(db, company_id=demo["company_id"],
                                 bank_account_id=demo["bank_account_id"], csv_text=CSV)
    db.commit()

    rec = banking.reconcile(db, company_id=demo["company_id"],
                            bank_account_id=demo["bank_account_id"], as_of=date(2026, 11, 7))
    db.commit()
    assert rec["matched_count"] == 2              # receipt + payment
    assert rec["book_balance"] == Decimal("118000.00")
    assert rec["statement_balance"] == Decimal("117000.00")
    # the ₹1,000 charge is on the statement but not yet in the books
    assert len(rec["unmatched_statement"]) == 1
    assert rec["unmatched_statement"][0]["amount"] == Decimal("-1000.00")
    assert rec["unmatched_book"] == []
    assert rec["difference_explained"] is True    # 1,000 difference is explained
    assert rec["is_reconciled"] is False

    # Book the bank charge, then reconcile again -> fully reconciled.
    banking.bank_charge(db, company_id=demo["company_id"], bank_account_id=demo["bank_account_id"],
                        amount=Decimal("1000"), vdate=date(2026, 11, 6), ref="PV:CHG-1")
    db.commit()
    rec2 = banking.reconcile(db, company_id=demo["company_id"],
                             bank_account_id=demo["bank_account_id"], as_of=date(2026, 11, 7))
    db.commit()
    assert rec2["matched_count"] == 3
    assert rec2["unmatched_statement"] == [] and rec2["unmatched_book"] == []
    assert rec2["book_balance"] == rec2["statement_balance"] == Decimal("117000.00")
    assert rec2["is_reconciled"] is True


def test_banking_over_api(client, auth_headers, db, demo):
    # receipt + payment via API
    assert client.post("/api/banking/receipts", headers=auth_headers, json={
        "bank_account_id": str(demo["bank_account_id"]), "customer_id": str(demo["customer_id"]),
        "amount": "236000", "date": "2026-11-05", "reference": "RV:API-1"}).status_code == 201
    assert client.post("/api/banking/payments", headers=auth_headers, json={
        "bank_account_id": str(demo["bank_account_id"]), "supplier_id": str(demo["supplier_id"]),
        "amount": "118000", "date": "2026-11-06", "reference": "PV:API-1"}).status_code == 201

    imp = client.post(f"/api/banking/{demo['bank_account_id']}/import-statement",
                      headers=auth_headers, json={"csv_text": CSV}).json()
    assert imp["created"] == 3

    rec = client.post(f"/api/banking/{demo['bank_account_id']}/reconcile?as_of=2026-11-07",
                      headers=auth_headers).json()
    assert rec["matched_count"] == 2
    assert rec["book_balance"] == "118000.00"
