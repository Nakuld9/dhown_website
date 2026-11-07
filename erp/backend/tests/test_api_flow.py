"""End-to-end API tests: auth, RBAC, masters, voucher posting, reporting."""
from __future__ import annotations

from sqlalchemy import select

from app.core.security import hash_password
from app.models.core import Role, User


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_login_and_me(client, auth_headers):
    resp = client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "admin"
    assert body["is_superuser"] is True


def test_unauthenticated_rejected(client):
    assert client.get("/api/accounts").status_code == 401


def test_chart_of_accounts_served(client, auth_headers):
    resp = client.get("/api/accounts", headers=auth_headers)
    assert resp.status_code == 200
    codes = {a["code"] for a in resp.json()}
    assert {"1100", "2010", "4010", "5150"}.issubset(codes)


def test_create_and_list_customer(client, auth_headers):
    payload = {"code": "C001", "name": "Acme Garments", "gstin": "03AAAAA0000A1Z5", "state_code": "03"}
    resp = client.post("/api/masters/customers", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    # duplicate code rejected
    assert client.post("/api/masters/customers", json=payload, headers=auth_headers).status_code == 409
    listed = client.get("/api/masters/customers", headers=auth_headers).json()
    assert any(c["code"] == "C001" for c in listed)


def test_post_voucher_via_api_and_trial_balance(client, auth_headers):
    payload = {
        "voucher_type_code": "PI",
        "voucher_date": "2026-11-07",
        "posting_reference": "API:PI-0001",
        "narration": "Chemical purchase via API",
        "lines": [
            {"account_code": "1100", "debit": "100000", "credit": "0"},
            {"account_code": "1121", "debit": "9000", "credit": "0"},
            {"account_code": "1122", "debit": "9000", "credit": "0"},
            {"account_code": "2010", "debit": "0", "credit": "118000"},
        ],
    }
    resp = client.post("/api/vouchers", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "POSTED"

    tb = client.get("/api/reports/trial-balance", headers=auth_headers).json()
    assert tb["is_balanced"] is True
    assert tb["totals"]["closing_debit"] == tb["totals"]["closing_credit"]


def test_unbalanced_voucher_via_api_is_422(client, auth_headers):
    payload = {
        "voucher_type_code": "JV",
        "voucher_date": "2026-11-07",
        "posting_reference": "API:BAD-0001",
        "lines": [
            {"account_code": "1100", "debit": "100", "credit": "0"},
            {"account_code": "2010", "debit": "0", "credit": "90"},
        ],
    }
    assert client.post("/api/vouchers", json=payload, headers=auth_headers).status_code == 422


def test_rbac_blocks_unauthorised_posting(client, db):
    """Acceptance TEST 19 (access control): a read-only auditor cannot post."""
    auditor_role = db.execute(select(Role).where(Role.code == "AUDITOR")).scalar_one()
    company_id = db.execute(select(User).where(User.username == "admin")).scalar_one().company_id
    auditor = User(
        username="auditor1",
        email="auditor@demo.local",
        full_name="Read Only",
        hashed_password=hash_password("audit123"),
        is_active=True,
        is_superuser=False,
        company_id=company_id,
    )
    auditor.roles.append(auditor_role)
    db.add(auditor)
    db.commit()

    token = client.post(
        "/api/auth/login", data={"username": "auditor1", "password": "audit123"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "voucher_type_code": "JV",
        "voucher_date": "2026-11-07",
        "posting_reference": "API:RBAC-0001",
        "lines": [
            {"account_code": "1100", "debit": "100", "credit": "0"},
            {"account_code": "2010", "debit": "0", "credit": "100"},
        ],
    }
    assert client.post("/api/vouchers", json=payload, headers=headers).status_code == 403
    # but the auditor CAN read the chart of accounts
    assert client.get("/api/accounts", headers=headers).status_code == 200
