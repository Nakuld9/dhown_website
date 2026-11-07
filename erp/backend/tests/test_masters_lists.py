"""Master lookup-list endpoints that populate transaction-entry dropdowns."""
from __future__ import annotations


def test_lookup_lists(client, auth_headers, demo):
    chems = client.get("/api/masters/chemicals", headers=auth_headers).json()
    assert any(c["code"] == "RB-01" and c["is_dye"] for c in chems)

    taxes = client.get("/api/masters/tax-codes", headers=auth_headers).json()
    assert any(t["code"] == "GST18" for t in taxes)

    jets = client.get("/api/masters/machines?machine_type=DYEING", headers=auth_headers).json()
    assert all(m["machine_type"] == "DYEING" for m in jets) and len(jets) >= 1

    shades = client.get("/api/masters/shades", headers=auth_headers).json()
    assert any(s["code"] == "SH-NAVY" for s in shades)

    versions = client.get("/api/masters/recipe-versions", headers=auth_headers).json()
    assert any(v["recipe_code"] == "R-NAVY" for v in versions)
