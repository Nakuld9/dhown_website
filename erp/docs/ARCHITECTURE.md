# System Architecture — Integrated Textile Manufacturing ERP

> Status: **Stage 1 foundation implemented.** This document is the overall
> target architecture; sections marked _(planned)_ are specified here and built
> in later stages. See `../README.md` for the stage-by-stage status matrix.

## 1. Architectural style

A **modular monolith**: one deployable backend process, cleanly partitioned into
modules that own their tables and expose services to one another through
in-process service functions (not shared table writes). This keeps the system
simple to run and transaction-safe for accounting, while leaving clear seams to
split a module into a service later if volume demands it.

```
                        ┌─────────────────────────────────────────────┐
   Browser (Next.js)    │                 FastAPI app                  │
   ───────────────▶     │  api/routes  ──▶  services  ──▶  models (ORM)│
   REST + WebSocket     │        │             │              │        │
                        │        │       posting engine       │        │
                        │        │       (the only writer      │        │
                        │        │        to the ledger)       │        │
                        └────────┼─────────────┼──────────────┼────────┘
                                 │             │              │
                             PostgreSQL  background worker  integration
                             (authoritative)  (queues/retry) adapters
                                                            (Color Service)
```

### Why a monolith first
Double-entry posting, inventory movement and the source document must commit in
**one database transaction** (accounting rule #8). A monolith makes that atomic
without distributed-transaction machinery. Modules are isolated by package and
by table ownership, not by network boundaries.

## 2. Module map

| Module | Package | Owns | Depends on |
|---|---|---|---|
| Core / Access | `app.models.core`, `app.core` | companies, branches, users, roles, permissions | — |
| Master Data | `app.models.masters` | customers, suppliers, items, machines, chemicals, recipes, UoM, tax codes, cost centres | Core |
| Accounting | `app.models.accounting`, `app.services.accounting` | chart of accounts, vouchers, journal lines, periods, posting rules | Core, Masters |
| Audit / Control | `app.models.audit`, `app.services.audit` | audit_logs, document_sequences | — |
| Sales / Purchase _(planned)_ | — | orders, invoices, GRNs | Masters, Accounting, Inventory |
| Manufacturing _(planned)_ | — | knitting, greige rolls, dye batches/baths, lab dips | Masters, Inventory |
| Dispensing integration _(planned)_ | — | dispensing devices/transactions/corrections, integration events | Manufacturing, Inventory |
| Inventory _(planned)_ | — | stock balances, valuation layers, inventory transactions | Masters, Accounting |
| Costing / Reporting | `app.services.accounting.trial_balance` (+planned) | trial balance, financial statements, cost roll-ups | Accounting, Inventory |

**Dependency rule:** modules depend _downward_ (towards Core). The posting
engine is the single sanctioned writer to the ledger; no module inserts
`journal_lines` directly.

## 3. The posting engine (the heart)

Every business event that has a financial effect calls
`app.services.accounting.posting_engine.post_voucher()` with a
`PostingRequest`. The engine:

1. Checks the `posting_reference` for idempotency (rule #6/#7) — re-posting the
   same event returns the existing voucher instead of duplicating it.
2. Validates each line is one-sided and non-negative, and that total debits ==
   total credits using `Decimal` arithmetic (rules #1, #2, #9, #18).
3. Resolves the open accounting period for the date (rule #13).
4. Resolves postable (non-group) accounts and cost-centre requirements.
5. Allocates a gap-free voucher number from `document_sequences`.
6. Writes the voucher + lines + audit log inside the caller's transaction.

Corrections never edit posted data; `reverse_voucher()` writes a mirror-image
REVERSAL voucher and flips the original to REVERSED (rules #3, #4). An ORM-level
guard (`app.core.ledger_guard`) blocks any other mutation or deletion of posted
rows — enforcement, not convention.

### Automatic posting (event-driven) _(engine ready, rules being populated)_
Business modules translate their events to a `PostingRequest` via **configurable
posting rules** (`accounting_posting_rules`) that map a semantic slot (e.g.
`inventory`, `input_cgst`, `supplier_payable`) to an account code per company.
The posting matrix for every event type is specified in
`ACCOUNTING_POSTING_MATRIX.md`. Because the mapping is data, the chart of
accounts and GST treatment stay configurable (no hardcoded accounts or rates).

## 4. Data integrity & money

- **No floats.** Money and quantities use Decimal-safe column types
  (`app.core.types.Money`, `Quantity`) → `NUMERIC(18,2)` / `NUMERIC(20,6)` on
  PostgreSQL, exact TEXT round-trip on SQLite (rules #16–#19).
- **UUID primary keys** everywhere.
- **Immutable ledger** via session-level guard + reversal-only corrections.
- **Multi-company isolation**: every business row carries `company_id`; queries
  and the posting engine scope by it (rule #20).
- **Audit trail**: append-only `audit_logs`; per-row `created_by/updated_by`.

## 5. Technology

| Concern | Choice | Notes |
|---|---|---|
| Backend | Python 3.11+ / FastAPI | first preference in the brief; `Decimal` discipline |
| ORM / migrations | SQLAlchemy 2 / Alembic | models are the single source of truth |
| Database | PostgreSQL 16 | authoritative store; SQLite only for fast tests |
| Auth | OAuth2 password + JWT, bcrypt | RBAC by permission code |
| Frontend _(planned)_ | Next.js + React + TS + Tailwind + shadcn/ui + Recharts | per brief |
| Realtime _(planned)_ | WebSocket | live dispensing / dashboards |
| Packaging | Docker + docker compose | Postgres + API; migrate+seed on boot |

Browser/local storage is **never** the authoritative accounting store — Postgres
is.

## 6. Request lifecycle (posting a voucher)

```
POST /api/vouchers
  → auth: decode JWT, load user
  → RBAC: require 'voucher.post'
  → validate payload (Pydantic)
  → posting_engine.post_voucher(session, request)   # all-or-nothing
  → session.commit()                                # atomic
  → 201 with the posted voucher
```

A failure at any step rolls the transaction back; nothing partial reaches the
ledger. If an automatic posting from a business event fails, the source
transaction is left flagged pending/failed for reconciliation (rule 13C) —
_wired as business modules land._

## 7. Security & access control

JWTs carry the subject and role codes; permissions resolve from roles at request
time. `require_permission("...")` guards each route. The control rules in brief
§21 (operators cannot edit approved recipes or dispensing records; store staff
cannot touch vouchers; closed periods need authorized reopening; posted entries
are immutable) are enforced by a mix of permission codes and the ledger guard.

## 8. Deployment & operations _(baseline)_

`docker compose up` starts Postgres and the API; the API container waits for the
DB, runs `alembic upgrade head`, seeds idempotently, then serves uvicorn.
Backups, structured error logging and integration monitoring are specified for
Stage 9; the schema and audit log already support them.
