"""Stage 2: knitting production issues yarn and creates traceable greige rolls.

Acceptance TEST 2 (yarn issue with inventory + accounting) and TEST 3 (greige
batch with all rolls traceable).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.inventory import ItemType
from app.models.manufacturing import KnittingProduction, RollKind
from app.services import inventory
from app.services.manufacturing.knitting import record_production


def test_knitting_issues_yarn_and_makes_greige_rolls(db, demo):
    yarn_before = inventory.balance(
        db, company_id=demo["company_id"], item_type=ItemType.YARN, item_id=demo["yarn_id"]
    )
    kp = KnittingProduction(
        company_id=demo["company_id"], number="KP-0001", machine_id=demo["machines"]["knit"],
        yarn_id=demo["yarn_id"], fabric_type_id=demo["fabric_type_id"],
        production_date=date(2026, 11, 7), shift="A",
        produced_kg=Decimal("250"), yarn_consumed_kg=Decimal("255"), wastage_kg=Decimal("5"),
    )
    db.add(kp)
    db.flush()

    rolls = [
        {"roll_no": "R-0001", "weight_kg": "125", "length_m": "400", "warehouse_id": demo["warehouses"]["greige"]},
        {"roll_no": "R-0002", "weight_kg": "125", "length_m": "400", "warehouse_id": demo["warehouses"]["greige"]},
    ]
    result = record_production(db, kp, rolls)
    db.commit()

    # Yarn (240/kg opening) * 255 kg = 61,200 consumed.
    assert result["yarn_cost"] == Decimal("61200.00")
    assert result["issue_voucher"].total_debit == result["issue_voucher"].total_credit
    assert result["produce_voucher"].total_debit == Decimal("61200.00")

    yarn_after = inventory.balance(
        db, company_id=demo["company_id"], item_type=ItemType.YARN, item_id=demo["yarn_id"]
    )
    assert yarn_before["qty_on_hand"] - yarn_after["qty_on_hand"] == Decimal("255.000000")

    assert len(result["rolls"]) == 2
    for roll in result["rolls"]:
        assert roll.kind == RollKind.GREIGE
        assert roll.knitting_production_id == kp.id  # traceable back to production
