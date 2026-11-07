# Integrated Textile Manufacturing ERP

A production-grade ERP for an integrated knitting, dyeing and finishing textile
company, built around a **correct double-entry accounting engine** with Indian
GST support, full traceability from sales order to general ledger, and a
specified (pending-verification) Color Service dispensing integration.

> **Scope honesty.** The brief describes a product a team builds over many
> months. This repository delivers **Stage 1: the foundation** — architecture,
> the full data-model foundation, auth/RBAC, the chart of accounts, and a
> **working, tested double-entry posting engine + trial balance** — plus the
> four design documents the brief asks to start with. Later stages (sales,
> purchase, knitting, dyeing, dispensing, inventory valuation, financial
> statements, dashboards, Next.js UI) are specified in `docs/` and listed below
> as pending. Nothing here claims GST filing, bank feeds or Color Service
> integration are production-ready.

## What works today (verified by tests)

- **Double-entry posting engine** — balanced-only posting, one-sided lines,
  Decimal money (no floats), idempotent `posting_reference`, atomic commit.
- **Immutable ledger** — posted vouchers/lines cannot be edited or deleted
  (enforced at the ORM session level); corrections via reversal vouchers.
- **Chart of accounts** — full textile COA seeded (assets, liabilities, equity,
  income, direct/indirect expenses), configurable & hierarchical.
- **Accounting periods** — Indian FY (Apr–Mar); posting into a **closed** period
  is blocked.
- **14 voucher types**, gap-free document numbering.
- **Trial balance** (always balances) + **account ledger** drill-down.
- **Auth + RBAC** — JWT login, 15 roles, permission-gated routes.
- **Master data** foundation (customers, suppliers, chemicals/dyes, lots,
  recipes, machines, warehouses, UoM, tax codes, cost centres, …).
- **Alembic migrations** + idempotent **seed**, **Docker Compose** stack.

`32 passing tests` cover the accounting invariants, the nine worked posting
examples from the brief, correction dosing, RBAC, and the full-cycle trial
balance. See the acceptance-test map below.

## Design documents (start here)

| Doc | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modular-monolith design, module map, posting engine, integrity rules |
| [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md) | Mermaid ER diagrams + the master traceability chain |
| [`docs/ACCOUNTING_POSTING_MATRIX.md`](docs/ACCOUNTING_POSTING_MATRIX.md) | Dr/Cr rules for every business event |
| [`docs/COLOR_SERVICE_INTEGRATION.md`](docs/COLOR_SERVICE_INTEGRATION.md) | Dispensing integration spec, adapters, simulator |

## Quick start

### Option A — Docker (Postgres + API)
```bash
cd erp
cp backend/.env.example backend/.env      # then edit SECRET_KEY / admin password
docker compose up --build
# API:  http://localhost:8000      Docs: http://localhost:8000/docs
```
The API container waits for Postgres, runs migrations, seeds the demo company
and admin user, then serves.

### Option B — Local (SQLite, no server)
```bash
cd erp/backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="sqlite:///./erp.db" SECRET_KEY="dev-secret-$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"
alembic upgrade head
python -m app.seed.seed
uvicorn app.main:app --reload
```

### Run the tests
```bash
cd erp/backend && . .venv/bin/activate && pytest
```

### First login
Seeded superuser: **`admin` / `admin123`** (override via `ERP_ADMIN_*` env vars;
change it immediately outside dev).
```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -d 'username=admin&password=admin123' | python -m json.tool
```

## Project layout
```
erp/
├── docs/                      # the four design documents
├── docker-compose.yml
└── backend/
    ├── app/
    │   ├── core/              # config, db, security, Decimal types, ledger guard, deps
    │   ├── models/            # core, masters, accounting, audit (ORM)
    │   ├── services/          # posting engine, trial balance, sequences, audit
    │   ├── api/routes/        # auth, masters, accounts, vouchers, reports
    │   └── seed/              # chart of accounts, RBAC, seeder
    ├── alembic/               # migrations (baseline from metadata)
    └── tests/                 # 32 tests: invariants, posting matrix, TB, API
```

## Stage status (brief §22)

| Stage | Scope | Status |
|---|---|---|
| 1 | Architecture, schema foundation, auth, master data | **Done (foundation)** |
| 6 | Double-entry engine, chart of accounts, vouchers | **Done (core + TB)** |
| 2 | Sales, purchase, knitting, fabric inventory | Specified / pending |
| 3 | Batching, recipes, lab dips, dyeing | Masters done; txns pending |
| 4 | Color Service integration + bath-wise consumption | Spec + simulator plan; pending |
| 5 | Chemical inventory + inventory accounting | Control accounts ready; valuation pending |
| 7 | GST, banking, financial statements, reconciliation | GST structure ready; reports pending |
| 8 | Costing, finishing, quality, dashboards | Cost centres ready; pending |
| 9 | Reports, security hardening, deployment | RBAC + Docker done; rest pending |

## Acceptance-test coverage (brief §23)

| # | Acceptance test | Status |
|---|---|---|
| 1 | Chemical purchase + GST → purchase voucher | ✅ `test_example1…` |
| 9 | Dr WIP / Cr Chemical Inventory on consumption | ✅ `test_example2…` |
| 10 | 200 g correction dosing = separate transaction | ✅ `test_correction_dosing…` |
| 12 | WIP → Finished Goods transfer | ✅ `test_example7…` |
| 13 | Sales invoice with GST postings | ✅ `test_example4…` |
| 14 | Customer receipt (+ reconciliation structure) | ✅ receipt; bank-rec pending |
| 15 | Trial balance debit == credit | ✅ `test_trial_balance…` |
| 17 | Stock valuation reconciles with control account | ✅ foundation; full sub-ledger pending |
| 18 | Reconnect integration → no duplicates | ✅ `test_idempotent_posting_reference` |
| 19 | No unauthorized change to posted/dispensing data | ✅ `test_posted_*`, `test_rbac_*` |
| 2–8, 11, 16, 20 | Yarn/knitting/greige/dye batch/recipe scaling/Color Service send+receive/bath cost/P&L+BS/full trace | ⏳ pending (schema + spec in place) |

## Non-negotiables honoured

No floating point in money/quantities; posted entries immutable; every voucher
balances or nothing commits; unique posting identity + idempotency; closed-period
locks; multi-company isolation; complete audit trail. See
`docs/ACCOUNTING_POSTING_MATRIX.md` §Invariants.

## License / originality
Original implementation. No proprietary ERP code, branding or copyrighted
designs are used.
