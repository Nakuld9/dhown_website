"""Acceptance TEST 20: trace a dyed roll back to order, yarn, machine, batch,
bath, chemical lot and the accounting entries."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models.accounting import Voucher
from app.models.commercial import SalesOrder, SalesOrderLine
from app.models.manufacturing import DyeBatch, DyeBath, KnittingProduction, BatchStatus
from app.models.masters import ChemicalLot
from app.services.colorservice import ColorServiceSimulator
from app.services.colorservice import ingest as cs
from app.services.manufacturing.knitting import record_production


def test_full_chain_traceability(db, demo):
    company_id = demo["company_id"]

    # 1) Sales order
    so = SalesOrder(company_id=company_id, customer_id=demo["customer_id"], number="SO-0001",
                    order_date=date(2026, 11, 1))
    so.lines.append(SalesOrderLine(line_no=1, fabric_type_id=demo["fabric_type_id"],
                                   shade_id=demo["shade_id"], qty_kg=Decimal("250"),
                                   rate=Decimal("800"), tax_code_id=demo["tax_id"]))
    db.add(so)
    db.flush()

    # 2) Knitting -> greige rolls (linked to the order)
    kp = KnittingProduction(company_id=company_id, number="KP-T1", machine_id=demo["machines"]["knit"],
                            sales_order_id=so.id, yarn_id=demo["yarn_id"],
                            fabric_type_id=demo["fabric_type_id"], production_date=date(2026, 11, 3),
                            produced_kg=Decimal("250"), yarn_consumed_kg=Decimal("255"))
    db.add(kp)
    db.flush()
    result = record_production(db, kp, [{"roll_no": "R-T1", "weight_kg": "250",
                                         "warehouse_id": demo["warehouses"]["greige"]}])
    roll = result["rolls"][0]

    # 3) Dye batch linked to the roll + 4) bath with approved recipe
    batch = DyeBatch(company_id=company_id, batch_code="DY-T1", sales_order_id=so.id,
                     shade_id=demo["shade_id"], fabric_kg=Decimal("250"), status=BatchStatus.RUNNING)
    batch.rolls.append(roll)
    db.add(batch)
    db.flush()
    roll.dye_batch_id = batch.id
    bath = DyeBath(company_id=company_id, batch_id=batch.id, bath_code="DY-T1-B01",
                   machine_id=demo["machines"]["jet"], recipe_version_id=demo["recipe_version_id"],
                   fabric_kg=Decimal("250"),
                   actual_start=datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc))
    db.add(bath)
    db.flush()

    # 5) Dispense + consume
    adapter = ColorServiceSimulator(lot_by_material=demo["lot_refs"])
    _ack, order = cs.send_dose_order(db, bath, adapter)
    cs.ingest_results(db, company_id, bath, adapter.fetch_results(order))
    db.commit()

    # ---- Walk the chain backwards from a dispensing transaction ----
    txn = bath  # start from the bath we have
    assert txn.batch.batch_code == "DY-T1"
    traced_roll = txn.batch.rolls[0]
    assert traced_roll.roll_no == "R-T1"

    # roll -> knitting -> yarn + machine + order
    kprod = db.get(KnittingProduction, traced_roll.knitting_production_id)
    assert kprod.yarn_id == demo["yarn_id"]
    assert kprod.machine_id == demo["machines"]["knit"]
    assert kprod.sales_order_id == so.id

    # dispensing -> chemical lot
    disp = bath  # dispensing transactions
    from app.models.dispensing import DispensingTransaction
    dts = db.execute(select(DispensingTransaction).where(DispensingTransaction.bath_id == bath.id)).scalars().all()
    assert dts and all(t.chemical_lot_id is not None for t in dts)
    lot = db.get(ChemicalLot, dts[0].chemical_lot_id)
    assert lot.internal_lot_no.startswith("LOT-")

    # dispensing -> accounting voucher
    voucher = db.execute(
        select(Voucher).where(Voucher.posting_reference == dts[0].posting_reference)
    ).scalar_one()
    assert voucher.total_debit == voucher.total_credit == dts[0].consumption_cost

    # And forward: order is the originating demand for this roll.
    assert traced_roll.sales_order_id == so.id
