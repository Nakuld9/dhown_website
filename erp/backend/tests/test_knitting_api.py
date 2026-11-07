"""Knitting production entry over the API (+ its lookup lists)."""
from __future__ import annotations


def test_knitting_lookup_lists(client, auth_headers, demo):
    yarns = client.get("/api/masters/yarns", headers=auth_headers).json()
    assert any(y["code"] == "Y-30S" for y in yarns)
    knit = client.get("/api/masters/machines?machine_type=KNITTING", headers=auth_headers).json()
    assert any(m["code"] == "K-01" for m in knit)
    fabrics = client.get("/api/masters/fabric-types", headers=auth_headers).json()
    assert any(f["code"] == "SJ-160" for f in fabrics)


def test_post_knitting_production(client, auth_headers, demo):
    payload = {
        "number": "KP-API-1", "machine_id": str(demo["machines"]["knit"]),
        "yarn_id": str(demo["yarn_id"]), "production_date": "2026-11-07",
        "produced_kg": "250", "yarn_consumed_kg": "255", "wastage_kg": "5",
        "fabric_type_id": str(demo["fabric_type_id"]),
        "rolls": [
            {"roll_no": "R-API-1", "weight_kg": "125", "warehouse_id": str(demo["warehouses"]["greige"])},
            {"roll_no": "R-API-2", "weight_kg": "125", "warehouse_id": str(demo["warehouses"]["greige"])},
        ],
    }
    r = client.post("/api/knitting/production", headers=auth_headers, json=payload)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["rolls_created"] == 2
    assert body["yarn_cost"] == "61200.00"     # 255 kg x 240
    assert body["issue_voucher"] and body["produce_voucher"]

    listed = client.get("/api/knitting/production", headers=auth_headers).json()
    assert any(k["number"] == "KP-API-1" for k in listed)
