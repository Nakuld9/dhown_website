"""Stage 3 + 4: recipe scaling, Color Service dose order (simulator), dispensing
ingest, bath consumption register, correction dosing, replay-safety.

Acceptance TESTs 4, 5, 6, 7, 8, 9, 10, 11, 18.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select

from app.models.dispensing import DispensingCorrection, DispensingTransaction
from app.models.accounting import Voucher
from app.models.manufacturing import DyeBatch, DyeBath, BatchStatus
from app.models.masters import RecipeVersion
from app.services.colorservice import ColorServiceSimulator
from app.services.colorservice import ingest as cs
from app.services.colorservice.register import bath_consumption_register
from app.services.manufacturing.recipes import scale_recipe


def _setup_bath(db, demo, fabric_kg="250"):
    batch = DyeBatch(company_id=demo["company_id"], batch_code="DY-26001",
                     shade_id=demo["shade_id"], fabric_kg=Decimal(fabric_kg),
                     status=BatchStatus.RUNNING)
    db.add(batch)
    db.flush()
    bath = DyeBath(company_id=demo["company_id"], batch_id=batch.id, bath_code="DY-26001-B01",
                   machine_id=demo["machines"]["jet"], recipe_version_id=demo["recipe_version_id"],
                   fabric_kg=Decimal(fabric_kg), liquor_ratio=Decimal("8"),
                   actual_start=datetime(2026, 11, 7, 9, 0, tzinfo=timezone.utc),
                   status=BatchStatus.RUNNING)
    db.add(bath)
    db.flush()
    return batch, bath


def _adapter(demo):
    return ColorServiceSimulator(variance_pct="0.5", lot_by_material=demo["lot_refs"])


def test_recipe_scales_to_fabric_weight(db, demo):
    """TEST 4: 250 kg fabric, Reactive Blue 1.4% OWF -> 3.50 kg."""
    version = db.get(RecipeVersion, demo["recipe_version_id"])
    scaled = {m["material_code"]: m["required_kg"] for m in scale_recipe(db, version, Decimal("250"))}
    assert scaled["RB-01"] == Decimal("3.500000")
    assert scaled["RBK-01"] == Decimal("1.200000")
    assert scaled["SALT"] == Decimal("50.000000")
    assert scaled["SODA"] == Decimal("15.000000")


def test_send_dose_order_to_simulator(db, demo):
    """TEST 5: send recipe to Color Service via the (simulated) interface."""
    _batch, bath = _setup_bath(db, demo)
    ack, order = cs.send_dose_order(db, bath, _adapter(demo))
    db.commit()
    assert ack.accepted is True
    assert len(order.materials) == 4
    assert order.bath_code == "DY-26001-B01"


def test_ingest_dispensing_consumes_once_and_posts(db, demo):
    """TESTs 6-9: receive actuals, record per bath, deduct stock once, post
    Dr WIP / Cr inventory."""
    _batch, bath = _setup_bath(db, demo)
    adapter = _adapter(demo)
    _ack, order = cs.send_dose_order(db, bath, adapter)
    results = adapter.fetch_results(order)
    summary = cs.ingest_results(db, demo["company_id"], bath, results)
    db.commit()

    assert summary["processed"] == 4
    txns = db.execute(
        select(DispensingTransaction).where(DispensingTransaction.bath_id == bath.id)
    ).scalars().all()
    assert len(txns) == 4
    assert all(t.consumed for t in txns)

    rb = next(t for t in txns if t.material_code == "RB-01")
    assert rb.actual_weight == Decimal("3.517500")          # 3.5 * 1.005
    assert rb.consumption_cost == Decimal("4221.00")        # 3.5175 * 1200

    # One consumption voucher per material, each balanced.
    for t in txns:
        v = db.execute(select(Voucher).where(Voucher.posting_reference == t.posting_reference)).scalar_one()
        assert v.total_debit == v.total_credit == t.consumption_cost


def test_bath_consumption_register(db, demo):
    """TEST 11: recipe vs actual, variance, cost, per-kg, total bath cost."""
    _batch, bath = _setup_bath(db, demo)
    adapter = _adapter(demo)
    _ack, order = cs.send_dose_order(db, bath, adapter)
    cs.ingest_results(db, demo["company_id"], bath, adapter.fetch_results(order))
    db.commit()

    reg = bath_consumption_register(db, bath)
    assert reg["fabric_kg"] == Decimal("250.000000")
    rb = next(r for r in reg["rows"] if r["material_code"] == "RB-01")
    assert rb["recipe_target_kg"] == Decimal("3.500000")
    assert rb["actual_kg"] == Decimal("3.517500")
    assert rb["variance_kg"] == Decimal("0.017500")
    assert reg["total_cost"] > Decimal("0")
    assert reg["cost_per_kg_fabric"] == (reg["total_cost"] / Decimal("250")).quantize(Decimal("0.01"))


def test_correction_dosing_is_a_separate_transaction(db, demo):
    """TEST 10: a 200 g correction creates a new consumption + accounting txn;
    originals are not overwritten."""
    _batch, bath = _setup_bath(db, demo)
    adapter = _adapter(demo)
    _ack, order = cs.send_dose_order(db, bath, adapter)
    cs.ingest_results(db, demo["company_id"], bath, adapter.fetch_results(order))
    db.commit()
    rb_before = db.execute(
        select(DispensingTransaction).where(
            DispensingTransaction.bath_id == bath.id, DispensingTransaction.material_code == "RB-01",
            DispensingTransaction.is_correction.is_(False),
        )
    ).scalar_one()
    original_actual = rb_before.actual_weight

    correction = adapter.make_correction(order, "RB-01", Decimal("0.2"))
    summary = cs.ingest_results(db, demo["company_id"], bath, [correction])
    db.commit()

    assert summary["processed"] == 1
    corr_txn = db.execute(
        select(DispensingTransaction).where(
            DispensingTransaction.bath_id == bath.id, DispensingTransaction.is_correction.is_(True)
        )
    ).scalar_one()
    assert corr_txn.id != rb_before.id
    assert corr_txn.actual_weight == Decimal("0.200000")
    assert corr_txn.consumption_cost == Decimal("240.00")  # 0.2 * 1200
    # original untouched
    db.refresh(rb_before)
    assert rb_before.actual_weight == original_actual
    assert db.execute(
        select(func.count()).select_from(DispensingCorrection).where(DispensingCorrection.bath_id == bath.id)
    ).scalar_one() == 1


def test_reconnect_does_not_duplicate(db, demo):
    """TEST 18: re-ingesting the same results posts nothing new."""
    _batch, bath = _setup_bath(db, demo)
    adapter = _adapter(demo)
    _ack, order = cs.send_dose_order(db, bath, adapter)
    results = adapter.fetch_results(order)
    cs.ingest_results(db, demo["company_id"], bath, results)
    db.commit()

    def counts():
        txn = db.execute(select(func.count()).select_from(DispensingTransaction).where(
            DispensingTransaction.bath_id == bath.id)).scalar_one()
        vch = db.execute(select(func.count()).select_from(Voucher).where(
            Voucher.posting_reference.like(f"BATH:{bath.bath_code}:consume:%"))).scalar_one()
        return txn, vch

    first = counts()
    summary2 = cs.ingest_results(db, demo["company_id"], bath, results)  # replay
    db.commit()
    assert summary2["skipped"] == 4
    assert summary2["processed"] == 0
    assert counts() == first  # no new rows
