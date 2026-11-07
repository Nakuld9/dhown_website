"""Weighing-scale & knitting-machine integration + roll labels."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.manufacturing import FabricRoll, RollKind
from app.services import hardware


def test_scale_reading_ingest_idempotent(db, demo):
    sim = hardware.WeighingScaleSimulator("SCALE-01")
    msg = sim.read(Decimal("125"), reference_type="ROLL", reference_id=None, seq=1)
    r1 = hardware.ingest_scale_readings(db, demo["company_id"], [msg])
    r2 = hardware.ingest_scale_readings(db, demo["company_id"], [msg])  # replay
    db.commit()
    assert r1["created"] == 1 and r2["created"] == 0 and r2["skipped"] == 1


def test_knitting_logs_and_efficiency(db, demo):
    sim = hardware.KnittingMachineSimulator("K-01")
    logs = sim.generate(samples=4)   # 3 running (55 min, 25 kg each) + 1 stop (5 min down)
    hardware.ingest_knitting_logs(db, demo["company_id"], logs)
    db.commit()
    summary = {s["machine"]: s for s in hardware.knitting_machine_summary(db, demo["company_id"])}
    k = summary["K-01"]
    assert k["produced_kg"] == Decimal("75.000000")        # 3 x 25
    assert k["run_minutes"] == 165 and k["downtime_minutes"] == 5
    assert k["stops"] == 1
    # efficiency = 165 / 170 * 100
    assert k["efficiency_pct"] == Decimal("97.058824")


def test_knitting_log_ingest_is_idempotent(db, demo):
    sim = hardware.KnittingMachineSimulator("K-01")
    logs = sim.generate(samples=4)
    hardware.ingest_knitting_logs(db, demo["company_id"], logs)
    r2 = hardware.ingest_knitting_logs(db, demo["company_id"], logs)
    db.commit()
    assert r2["created"] == 0 and r2["skipped"] == 4


def test_hardware_api(client, auth_headers, demo):
    # simulate a scale capture + knitting monitoring, then read summaries
    sc = client.post("/api/hardware/simulate/scale", headers=auth_headers,
                     json={"scale_code": "SCALE-01", "weight": "126.5", "reference_type": "ROLL"})
    assert sc.status_code == 200 and sc.json()["created"] == 1
    kn = client.post("/api/hardware/simulate/knitting", headers=auth_headers,
                     json={"machine_code": "K-01", "samples": 4})
    assert kn.status_code == 200 and kn.json()["created"] == 4
    summ = client.get("/api/hardware/knitting-summary", headers=auth_headers).json()
    assert any(s["machine"] == "K-01" for s in summ)
    scales = client.get("/api/hardware/scales", headers=auth_headers).json()
    assert any(s["code"] == "SCALE-01" for s in scales)


def test_roll_label_pdf(client, auth_headers, db, demo):
    roll = FabricRoll(company_id=demo["company_id"], roll_no="R-LABEL-9", kind=RollKind.GREIGE,
                      weight_kg=Decimal("120"), gsm=Decimal("160"), width_cm=Decimal("180"),
                      fabric_type_id=demo["fabric_type_id"], barcode="R-LABEL-9")
    db.add(roll); db.commit()
    listed = client.get("/api/rolls", headers=auth_headers).json()
    assert any(r["roll_no"] == "R-LABEL-9" for r in listed)
    label = client.get(f"/api/rolls/{roll.id}/label", headers=auth_headers)
    assert label.status_code == 200
    assert label.headers["content-type"] == "application/pdf"
    assert label.content[:4] == b"%PDF"
