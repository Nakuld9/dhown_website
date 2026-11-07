"""Manufacturing costing & profitability (brief §14)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from app.models.commercial import SalesInvoice, SalesInvoiceLine, SalesOrder, SalesOrderLine
from app.models.manufacturing import BatchStatus, DyeBatch, DyeBath, KnittingProduction
from app.services import costing
from app.services.colorservice import ColorServiceSimulator
from app.services.colorservice import ingest as cs
from app.services.manufacturing.knitting import record_production
from app.services.sales import post_sales_invoice


def _scenario(db, demo):
    cid = demo["company_id"]
    so = SalesOrder(company_id=cid, customer_id=demo["customer_id"], number="SO-C1",
                    order_date=date(2026, 11, 1))
    so.lines.append(SalesOrderLine(line_no=1, fabric_type_id=demo["fabric_type_id"],
                                   qty_kg=Decimal("250"), rate=Decimal("800"), tax_code_id=demo["tax_id"]))
    db.add(so); db.flush()

    kp = KnittingProduction(company_id=cid, number="KP-C1", machine_id=demo["machines"]["knit"],
                            sales_order_id=so.id, yarn_id=demo["yarn_id"],
                            fabric_type_id=demo["fabric_type_id"], production_date=date(2026, 11, 3),
                            produced_kg=Decimal("250"), yarn_consumed_kg=Decimal("255"))
    db.add(kp); db.flush()
    record_production(db, kp, [{"roll_no": "R-C1", "weight_kg": "250",
                                "warehouse_id": demo["warehouses"]["greige"]}])

    batch = DyeBatch(company_id=cid, batch_code="DY-C1", sales_order_id=so.id, shade_id=demo["shade_id"],
                     fabric_kg=Decimal("250"), status=BatchStatus.RUNNING)
    db.add(batch); db.flush()
    bath = DyeBath(company_id=cid, batch_id=batch.id, bath_code="DY-C1-B01",
                   machine_id=demo["machines"]["jet"], recipe_version_id=demo["recipe_version_id"],
                   fabric_kg=Decimal("250"), actual_start=datetime(2026, 11, 5, 9, tzinfo=timezone.utc))
    db.add(bath); db.flush()
    adapter = ColorServiceSimulator(lot_by_material=demo["lot_refs"])
    _ack, order = cs.send_dose_order(db, bath, adapter)
    cs.ingest_results(db, cid, bath, adapter.fetch_results(order))

    inv = SalesInvoice(company_id=cid, customer_id=demo["customer_id"], sales_order_id=so.id,
                       number="INV-C1", invoice_date=date(2026, 11, 7))
    inv.lines.append(SalesInvoiceLine(line_no=1, description="Dyed fabric", qty=Decimal("250"),
                                      rate=Decimal("800"), tax_code_id=demo["tax_id"]))
    db.add(inv); db.flush(); post_sales_invoice(db, inv)
    db.commit()
    return so, batch, bath


def test_batch_cost(db, demo):
    _so, batch, _bath = _scenario(db, demo)
    c = costing.batch_cost(db, demo["company_id"], batch.id)
    assert c["dye_cost"] == Decimal("6030.00")          # RB 4221 + RBK 1809
    assert c["chemical_cost"] == Decimal("879.38")      # SALT 502.50 + SODA 376.88
    assert c["total_cost"] == Decimal("6909.38")
    assert c["cost_per_kg"] == Decimal("27.64")         # 6909.38 / 250


def test_standard_vs_actual(db, demo):
    _so, _batch, bath = _scenario(db, demo)
    s = costing.bath_standard_vs_actual(db, demo["company_id"], bath.id)
    assert s["total_standard_cost"] == Decimal("6875.00")   # recipe target x standard cost
    assert s["total_actual_cost"] == Decimal("6909.38")
    assert s["total_cost_variance"] == Decimal("34.38")


def test_order_and_customer_profitability(db, demo):
    so, _b, _ba = _scenario(db, demo)
    o = costing.order_profitability(db, demo["company_id"], so.id)
    assert o["revenue"] == Decimal("200000.00")
    assert o["yarn_cost"] == Decimal("61200.00")        # 255 kg x 240
    assert o["dyeing_cost"] == Decimal("6909.38")
    assert o["total_cost"] == Decimal("68109.38")
    assert o["gross_profit"] == Decimal("131890.62")

    custs = costing.customer_profitability(db, demo["company_id"])
    fh = next(c for c in custs if c["customer"] == "Fashion House")
    assert fh["revenue"] == Decimal("200000.00")
    assert fh["gross_profit"] == Decimal("131890.62")


def test_machine_shade_and_cost_per_kg(db, demo):
    _scenario(db, demo)
    machines = {m["machine"]: m for m in costing.machine_cost(db, demo["company_id"])}
    assert machines["JET-04"]["cost"] == Decimal("6909.38")
    assert machines["K-01"]["cost"] == Decimal("61200.00")

    shades = costing.shade_cost(db, demo["company_id"])
    assert any(s["shade"] == "SH-NAVY" and s["cost"] == Decimal("6909.38") for s in shades)

    cpk = costing.cost_per_kg_summary(db, demo["company_id"])
    assert cpk["knitted_cost_per_kg"] == Decimal("244.80")   # 61200 / 250
    assert cpk["dyeing_cost_per_kg"] == Decimal("27.64")     # 6909.38 / 250


def test_costing_api(client, auth_headers, db, demo):
    so, _b, _ba = _scenario(db, demo)
    o = client.get(f"/api/costing/orders/{so.id}", headers=auth_headers).json()
    assert o["gross_profit"] == "131890.62"
    cpk = client.get("/api/costing/cost-per-kg", headers=auth_headers).json()
    assert cpk["dyeing_cost_per_kg"] == "27.64"
