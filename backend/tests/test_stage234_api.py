"""API smoke test for the Stage 2-4 flow: GRN, dyeing bath, simulate dispense,
consumption register, sales invoice."""
from __future__ import annotations


def test_operations_flow_over_api(client, auth_headers, demo):
    company_chem = str(demo["chemicals"]["RB-01"])

    # 1) Post a chemical GRN.
    grn = client.post("/api/procurement/grn", headers=auth_headers, json={
        "supplier_id": str(demo["supplier_id"]), "number": "GRN-API-1",
        "grn_date": "2026-11-07",
        "lines": [{"chemical_id": company_chem, "chemical_lot_id": str(demo["lots"]["RB-01"]),
                   "warehouse_id": str(demo["warehouses"]["chem"]), "qty": "50",
                   "unit_cost": "1200", "tax_code_id": str(demo["tax_id"])}],
    })
    assert grn.status_code == 201, grn.text
    assert grn.json()["total"] == "70800.00"  # 60000 + 18%

    # 2) Create a dye batch + bath.
    batch = client.post("/api/dyeing/batches", headers=auth_headers, json={
        "batch_code": "DY-API-1", "fabric_kg": "250", "shade_id": str(demo["shade_id"])}).json()
    bath = client.post("/api/dyeing/baths", headers=auth_headers, json={
        "batch_id": batch["batch_id"], "bath_code": "DY-API-1-B01",
        "machine_id": str(demo["machines"]["jet"]), "recipe_version_id": str(demo["recipe_version_id"]),
        "fabric_kg": "250"}).json()
    bath_id = bath["bath_id"]

    # 3) Preview the scaled dose order.
    order = client.get(f"/api/dyeing/baths/{bath_id}/dose-order", headers=auth_headers).json()
    rb = next(m for m in order["materials"] if m["material_code"] == "RB-01")
    assert rb["target_qty"] == "3.500000"

    # 4) Simulate dispensing (send + ingest).
    disp = client.post(f"/api/dyeing/baths/{bath_id}/simulate-dispense", headers=auth_headers).json()
    assert disp["processed"] == 4

    # 5) Replay is idempotent via the same endpoint.
    disp2 = client.post(f"/api/dyeing/baths/{bath_id}/simulate-dispense", headers=auth_headers).json()
    assert disp2["processed"] == 0 and disp2["skipped"] == 4

    # 6) Consumption register.
    reg = client.get(f"/api/dyeing/baths/{bath_id}/consumption-register", headers=auth_headers).json()
    assert reg["bath_code"] == "DY-API-1-B01"
    assert float(reg["total_cost"]) > 0

    # 7) Sales invoice with GST.
    inv = client.post("/api/sales/invoices", headers=auth_headers, json={
        "customer_id": str(demo["customer_id"]), "number": "INV-API-1", "invoice_date": "2026-11-07",
        "lines": [{"description": "Dyed fabric", "qty": "250", "rate": "800",
                   "tax_code_id": str(demo["tax_id"])}]}).json()
    assert inv["total_value"] == "236000.00"
