# Integrated Textile Manufacturing ERP

A production-grade ERP for an integrated knitting, dyeing and finishing textile
company, built around a **correct double-entry accounting engine** with Indian
GST support, full traceability from sales order to general ledger, and a
specified (pending-verification) Color Service dispensing integration.

> **Scope honesty.** The brief describes a product a team builds over many
> months. This repository delivers **Stages 1–4 plus the accounting core
> (Stage 6)** as working, tested, database-backed code — architecture, the full
> data-model foundation, auth/RBAC, the double-entry engine + trial balance, the
> procurement→knitting→greige→dyeing→dispensing→consumption chain, FIFO
> inventory, and a **Color Service simulator** — plus the four design documents.
> Still pending (specified in `docs/`): financial statements (P&L/Balance
> Sheet/Cash Flow), banking/reconciliation, GST return preparation, management
> dashboards, finishing/quality, and the Next.js UI. Nothing here claims GST
> filing, bank feeds or **live** Color Service integration are production-ready —
> the dispensing integration runs against a simulator pending vendor
> verification.

## What works today (verified by tests)

**Accounting core**
- **Double-entry posting engine** — balanced-only posting, one-sided lines,
  Decimal money (no floats), idempotent `posting_reference`, atomic commit.
- **Immutable ledger** — posted vouchers/lines cannot be edited or deleted
  (enforced at the ORM session level); corrections via reversal vouchers.
- **Chart of accounts** — full textile COA seeded, configurable & hierarchical;
  **configurable posting rules** map each business event to accounts.
- **Accounting periods** (Indian FY, closed-period locks), **14 voucher types**,
  gap-free numbering, **trial balance** + **account ledger** drill-down.
- **Financial statements** (Stage 7) — **Profit & Loss**, **Balance Sheet**
  (balances by construction, folding current-year profit into equity),
  **Cash Flow** (operating/investing/financing, ledger-derived), and **debtor /
  creditor ageing** (FIFO allocation) — all derived from the posted ledger.
- **Indian GST** (Stage 7) — **sales & purchase registers**, **GSTR-1** summary
  (B2B/B2C, rate-wise, HSN-wise), **GSTR-3B** summary (outward tax, eligible
  ITC, net payable), and a **books-vs-registers reconciliation**; rates come
  from configurable tax codes, never hardcoded.

**Operations (Stage 2–4)**
- **Procurement** — chemical/dye GRN → FIFO stock layer + GST purchase voucher.
- **FIFO perpetual inventory** — costed receipts/consumption; stock sub-ledger
  reconciles with the GL control accounts.
- **Knitting** — yarn issue (FIFO) → traceable greige rolls + WIP/greige postings.
- **Recipe scaling** — %OWF / grams-per-kg (250 kg × 1.4% = 3.5 kg), approved
  versions only.
- **Dyeing** — batches/baths with roll traceability and the approved recipe.
- **Color Service** — dose-order builder, **simulator** adapter, idempotent
  ingest → immutable dispensing transactions → **consume stock exactly once** →
  Dr WIP / Cr inventory; **correction dosing** as separate transactions;
  **reconnect/replay never duplicates**; per-bath **consumption register**
  (recipe vs actual, variance, cost, per-kg).
- **Sales** — GST sales invoice posting (receivable + output tax).

**Platform** — JWT auth + RBAC (15 roles), REST API, Alembic migrations,
idempotent seed + demo data, Docker Compose.

`54 passing tests` cover the accounting invariants, the nine worked posting
examples, correction dosing, RBAC, full-cycle trial balance, procurement,
knitting, recipe scaling, the full dispensing cycle, end-to-end traceability,
the financial statements (P&L / Balance Sheet / Cash Flow / ageing), GST
(registers / GSTR-1 / GSTR-3B / reconciliation), and the
REST flow. See the acceptance-test map below.

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
    │   ├── models/            # core, masters, accounting, inventory, commercial,
    │   │                      #   manufacturing, dispensing, audit (ORM)
    │   ├── services/          # posting engine, trial balance, posting rules, tax,
    │   │                      #   inventory (FIFO), procurement, sales, knitting,
    │   │                      #   recipes, colorservice (adapter/simulator/ingest)
    │   ├── api/routes/        # auth, masters, accounts, vouchers, reports, operations
    │   └── seed/              # chart of accounts, RBAC, seeder, demo data
    ├── alembic/               # migrations (baseline from metadata)
    └── tests/                 # 54 tests: invariants, posting matrix, TB, procurement,
                               #   knitting, dyeing+dispensing, traceability, statements, gst, API
```

## Stage status (brief §22)

| Stage | Scope | Status |
|---|---|---|
| 1 | Architecture, schema foundation, auth, master data | **Done** |
| 2 | Sales, purchase, knitting, fabric inventory | **Done** (GRN, knitting, greige rolls, sales invoice) |
| 3 | Batching, recipes, lab dips, dyeing | **Done** (batches/baths, recipe scaling; lab-dip model) |
| 4 | Color Service integration + bath-wise consumption | **Done via simulator** (live adapter pending vendor) |
| 5 | Chemical inventory + inventory accounting | **Done** (FIFO valuation + GL reconciliation) |
| 6 | Double-entry engine, chart of accounts, vouchers | **Done** (core + TB) |
| 7 | GST, banking, financial statements, reconciliation | **P&L + BS + Cash Flow + ageing + GST registers/GSTR-1/3B/reconciliation done**; bank-rec & e-invoice/e-way pending |
| 8 | Costing, finishing, quality, dashboards | Cost centres + bath costing done; dashboards pending |
| 9 | Reports, security hardening, deployment | RBAC + Docker + API done; report exports pending |

## Acceptance-test coverage (brief §23)

| # | Acceptance test | Status |
|---|---|---|
| 1 | Chemical purchase + GST → purchase voucher | ✅ `test_stage2_procurement`, `test_example1` |
| 2 | Knitting order + yarn issue with auto inventory/accounting | ✅ `test_stage2_knitting` |
| 3 | Greige batch with all rolls traceable | ✅ `test_stage2_knitting`, `test_stage4_traceability` |
| 4 | 250 kg dye batch + scaled approved recipe | ✅ `test_recipe_scales_to_fabric_weight` |
| 5 | Send recipe to Color Service (verified interface) | ✅ via **simulator** `test_send_dose_order_to_simulator` |
| 6 | Receive actual dispensing transactions | ✅ `test_ingest_dispensing…` |
| 7 | Record every chemical against its dye-bath ID | ✅ `test_ingest_dispensing…`, register |
| 8 | Deduct actual consumption exactly once | ✅ `test_reconnect_does_not_duplicate` |
| 9 | Dr WIP / Cr inventory on consumption | ✅ `test_ingest_dispensing…`, `test_example2` |
| 10 | 200 g correction dosing = separate transaction | ✅ `test_correction_dosing…` |
| 11 | Final actual dye-bath cost | ✅ `test_bath_consumption_register` |
| 12 | WIP → Finished Goods transfer | ✅ `test_example7` |
| 13 | Sales invoice with GST postings | ✅ `test_stage2_sales`, `test_example4` |
| 15 | Trial balance debit == credit | ✅ `test_trial_balance…` |
| 18 | Reconnect integration → no duplicates | ✅ `test_reconnect_does_not_duplicate` |
| 19 | No unauthorized change to posted/dispensing data | ✅ `test_posted_*`, `test_rbac_*` |
| 16 | Generate Profit & Loss and Balance Sheet | ✅ `test_profit_and_loss`, `test_balance_sheet_balances` |
| 20 | Trace finished roll → order/yarn/machine/batch/bath/lot/GL | ✅ `test_full_chain_traceability` |
| 14, 17 | Bank reconciliation / stock-GL reconciliation report | ⏳ partial — receipt postings & FIFO valuation exist; dedicated bank-rec & reconciliation reports pending |

## Non-negotiables honoured

No floating point in money/quantities; posted entries immutable; every voucher
balances or nothing commits; unique posting identity + idempotency; closed-period
locks; multi-company isolation; complete audit trail. See
`docs/ACCOUNTING_POSTING_MATRIX.md` §Invariants.

## License / originality
Original implementation. No proprietary ERP code, branding or copyrighted
designs are used.
