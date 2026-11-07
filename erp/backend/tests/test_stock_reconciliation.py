"""Acceptance TEST 17: stock valuation reconciles with inventory control accounts."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from app.models.manufacturing import BatchStatus, DyeBatch, DyeBath
from app.services.accounting import stock_reconciliation as sr
from app.services.colorservice import ColorServiceSimulator
from app.services.colorservice import ingest as cs


def test_reconciles_after_opening_stock(db, demo):
    rec = sr.stock_ledger_reconciliation(db, demo["company_id"])
    by_acct = {r["account"]: r for r in rec["rows"]}
    assert by_acct["1090"]["stock_value"] == Decimal("1350000.00")   # dyes
    assert by_acct["1100"]["stock_value"] == Decimal("17500.00")     # chemicals
    assert by_acct["1060"]["stock_value"] == Decimal("480000.00")    # yarn
    for r in rec["rows"]:
        assert r["ledger_balance"] == r["stock_value"]
        assert r["difference"] == Decimal("0.00")
    assert rec["is_reconciled"] is True


def test_reconciles_after_consumption(db, demo):
    batch = DyeBatch(company_id=demo["company_id"], batch_code="DY-REC", shade_id=demo["shade_id"],
                     fabric_kg=Decimal("250"), status=BatchStatus.RUNNING)
    db.add(batch)
    db.flush()
    bath = DyeBath(company_id=demo["company_id"], batch_id=batch.id, bath_code="DY-REC-B01",
                   machine_id=demo["machines"]["jet"], recipe_version_id=demo["recipe_version_id"],
                   fabric_kg=Decimal("250"),
                   actual_start=datetime(2026, 11, 7, 9, 0, tzinfo=timezone.utc))
    db.add(bath)
    db.flush()
    adapter = ColorServiceSimulator(lot_by_material=demo["lot_refs"])
    _ack, order = cs.send_dose_order(db, bath, adapter)
    cs.ingest_results(db, demo["company_id"], bath, adapter.fetch_results(order))
    db.commit()

    rec = sr.stock_ledger_reconciliation(db, demo["company_id"])
    # consumption reduced both stock value and the GL control accounts equally
    assert rec["is_reconciled"] is True
    assert rec["total_difference"] == Decimal("0.00")


def test_stock_reconciliation_over_api(client, auth_headers, demo):
    r = client.get("/api/reports/stock-reconciliation", headers=auth_headers).json()
    assert r["is_reconciled"] is True
    x = client.get("/api/reports/export/stock-reconciliation?format=xlsx", headers=auth_headers)
    assert x.status_code == 200 and x.content[:2] == b"PK"
