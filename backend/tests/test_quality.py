"""Finishing & quality module (brief §12)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.manufacturing import FabricRoll, RollKind
from app.services import quality
from app.services.quality import InspectionResult


def _roll(db, demo, weight="100"):
    roll = FabricRoll(company_id=demo["company_id"], roll_no="R-Q1", kind=RollKind.GREIGE,
                      weight_kg=Decimal(weight), warehouse_id=demo["warehouses"]["greige"])
    db.add(roll)
    db.flush()
    return roll


def test_finishing_computes_shrinkage_and_finishes_roll(db, demo):
    roll = _roll(db, demo, "100")
    ft = quality.record_finishing(db, demo["company_id"], process_type="COMPACTING",
                                  process_date=date(2026, 11, 7), fabric_roll_id=roll.id,
                                  input_weight_kg=Decimal("100"), output_weight_kg=Decimal("96"),
                                  width_cm=Decimal("175"), gsm=Decimal("165"))
    db.commit()
    assert ft.shrinkage_pct == Decimal("4.000000")      # (100-96)/100*100
    db.refresh(roll)
    assert roll.kind == RollKind.FINISHED
    assert roll.width_cm == Decimal("175.000000")


def test_inspection_result_derivation():
    assert quality._derive_result(Decimal("0.8"), True) == InspectionResult.ACCEPT
    assert quality._derive_result(Decimal("1.5"), True) == InspectionResult.REWORK
    assert quality._derive_result(Decimal("3.0"), True) == InspectionResult.REJECT
    assert quality._derive_result(Decimal("0.2"), False) == InspectionResult.REJECT  # shade fail overrides


def test_inspection_updates_roll_status(db, demo):
    roll = _roll(db, demo)
    qi = quality.record_inspection(db, demo["company_id"], inspection_date=date(2026, 11, 7),
                                   fabric_roll_id=roll.id, delta_e=Decimal("3.5"), shade_match=True,
                                   inspected_qty=Decimal("100"), rejection_qty=Decimal("100"))
    db.commit()
    assert qi.result == InspectionResult.REJECT.value
    db.refresh(roll)
    assert roll.quality_status == "REJECT"


def test_quality_summary(db, demo):
    for de, insp, rej in [("0.5", "100", "0"), ("1.5", "100", "10"), ("4.0", "50", "50")]:
        quality.record_inspection(db, demo["company_id"], inspection_date=date(2026, 11, 7),
                                  delta_e=Decimal(de), shade_match=True,
                                  inspected_qty=Decimal(insp), rejection_qty=Decimal(rej))
    db.commit()
    s = quality.quality_summary(db, demo["company_id"], date(2026, 4, 1), date(2026, 11, 7))
    assert s["inspections"] == 3
    assert s["accepted"] == 1 and s["rework"] == 1 and s["rejected"] == 1
    assert s["rejection_qty"] == Decimal("60.000000")   # 0 + 10 + 50
    assert s["rejection_rate_pct"] == Decimal("24.000000")  # 60 / 250 * 100
    assert s["avg_delta_e"] == Decimal("2.000000")      # (0.5+1.5+4.0)/3


def test_complaint_lifecycle(db, demo):
    c = quality.raise_complaint(db, demo["company_id"], customer_id=demo["customer_id"],
                                complaint_date=date(2026, 11, 7), description="Shade variation in lot",
                                severity="HIGH", reference="INV-1")
    db.commit()
    assert c.status == "OPEN"
    quality.resolve_complaint(db, c.id, resolution="Re-dyed and replaced")
    db.commit()
    db.refresh(c)
    assert c.status == "RESOLVED" and c.resolved_at is not None


def test_quality_api_flow(client, auth_headers, demo):
    # record an inspection, raise + resolve a complaint, read summary
    insp = client.post("/api/quality/inspections", headers=auth_headers, json={
        "inspection_date": "2026-11-07", "delta_e": "0.7", "shade_match": True,
        "inspected_qty": "100", "rejection_qty": "2", "colour_fastness": "4-5"})
    assert insp.status_code == 201 and insp.json()["result"] == "ACCEPT"

    comp = client.post("/api/quality/complaints", headers=auth_headers, json={
        "customer_id": str(demo["customer_id"]), "complaint_date": "2026-11-07",
        "description": "Pilling reported", "severity": "MEDIUM"}).json()
    r = client.post(f"/api/quality/complaints/{comp['id']}/resolve", headers=auth_headers,
                    json={"resolution": "Credit note issued"})
    assert r.status_code == 200

    s = client.get("/api/quality/summary", headers=auth_headers).json()
    assert s["inspections"] == 1 and s["total_complaints"] == 1 and s["open_complaints"] == 0
