"""Management dashboards + warehouse master CRUD."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from app.models.commercial import SalesInvoice, SalesInvoiceLine
from app.models.manufacturing import BatchStatus, DyeBatch, DyeBath
from app.services import dashboard as dash
from app.services.colorservice import ColorServiceSimulator
from app.services.colorservice import ingest as cs
from app.services.sales import post_sales_invoice


def _activity(db, demo):
    inv = SalesInvoice(company_id=demo["company_id"], customer_id=demo["customer_id"],
                       number="INV-DSH-1", invoice_date=date(2026, 11, 7))
    inv.lines.append(SalesInvoiceLine(line_no=1, description="Fabric", qty=Decimal("250"),
                                      rate=Decimal("800"), tax_code_id=demo["tax_id"]))
    db.add(inv)
    db.flush()
    post_sales_invoice(db, inv)

    batch = DyeBatch(company_id=demo["company_id"], batch_code="DY-DSH", shade_id=demo["shade_id"],
                     fabric_kg=Decimal("250"), status=BatchStatus.RUNNING)
    db.add(batch)
    db.flush()
    bath = DyeBath(company_id=demo["company_id"], batch_id=batch.id, bath_code="DY-DSH-B01",
                   machine_id=demo["machines"]["jet"], recipe_version_id=demo["recipe_version_id"],
                   fabric_kg=Decimal("250"), actual_start=datetime(2026, 11, 7, 9, tzinfo=timezone.utc))
    db.add(bath)
    db.flush()
    adapter = ColorServiceSimulator(lot_by_material=demo["lot_refs"])
    _ack, order = cs.send_dose_order(db, bath, adapter)
    cs.ingest_results(db, demo["company_id"], bath, adapter.fetch_results(order))
    db.commit()


def test_owner_dashboard(db, demo):
    _activity(db, demo)
    d = dash.owner_dashboard(db, demo["company_id"], date(2026, 11, 7))
    assert d["revenue"] == Decimal("200000.00")
    assert d["net_profit"] == Decimal("200000.00")
    assert d["receivables"] == Decimal("236000.00")
    assert d["inventory_value"] > Decimal("0")
    assert any(pt["amount"] > 0 for pt in d["sales_trend"])


def test_accounts_dashboard(db, demo):
    _activity(db, demo)
    d = dash.accounts_dashboard(db, demo["company_id"], date(2026, 11, 7))
    assert d["debtors_total"] == Decimal("236000.00")
    assert d["gst_net_payable"] == Decimal("36000.00")   # output 36k, no ITC
    assert d["trial_balance_balanced"] is True
    assert any(b["name"] == "HDFC Current A/c" for b in d["bank_balances"])


def test_factory_and_chemical_dashboards(db, demo):
    _activity(db, demo)
    f = dash.factory_dashboard(db, demo["company_id"], date(2026, 11, 7))
    assert f["active_batches"] == 1
    assert f["dyeing_output_kg"] == Decimal("250.000000")
    assert f["chemical_consumption_cost"] > Decimal("0")

    c = dash.chemical_dashboard(db, demo["company_id"], date(2026, 11, 7))
    assert c["dye_cost"] > Decimal("0")
    assert c["total_consumption_cost"] == c["dye_cost"] + c["chemical_cost"]
    assert c["dispensing_errors"] == 0
    assert len(c["top_consumption"]) >= 1


def test_dashboard_api(client, auth_headers, demo):
    assert client.get("/api/dashboard/owner", headers=auth_headers).status_code == 200
    body = client.get("/api/dashboard/chemical", headers=auth_headers).json()
    assert "total_consumption_cost" in body


def test_ui_is_served(client):
    r = client.get("/app/")
    assert r.status_code == 200
    assert "Textile ERP" in r.text


def test_warehouse_crud(client, auth_headers, demo):
    listed = client.get("/api/masters/warehouses", headers=auth_headers).json()
    assert len(listed) == 3  # demo ships 3
    created = client.post("/api/masters/warehouses", headers=auth_headers,
                          json={"code": "WH-NEW", "name": "Dispatch Store", "kind": "FG"})
    assert created.status_code == 201
    assert len(client.get("/api/masters/warehouses", headers=auth_headers).json()) == 4
    # duplicate rejected
    dup = client.post("/api/masters/warehouses", headers=auth_headers,
                      json={"code": "WH-NEW", "name": "x", "kind": "STORE"})
    assert dup.status_code == 409
