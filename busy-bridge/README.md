# DHOWN BUSY Bridge

Integration middleware between **DHOWN MES** and **BUSY** accounting software.

There are exactly two systems. MES is the source of truth for production;
BUSY is the source of truth for accounting, commercial and statutory data.
The bridge is the only thing that talks to both.

```
DHOWN MES
   |  internal API (HTTP + JSON)
   v
BUSY BRIDGE
   |  master mapping -> validation -> transformation -> queue
   |  retry engine -> idempotency -> reconciliation -> audit
   v
BUSY
```

## What it does, and what it must never do

The bridge **translates, validates, queues, synchronises and reconciles
commercial data**. That is the whole job.

It contains no production planning, machine scheduling, AI capacity
calculation, machine monitoring, roll tracking or customer portal logic, and
no accounting logic is reimplemented on the MES side. Roll numbers may ride
along as free text on a document remark so they print on the challan, but the
bridge attaches no meaning to them.

## Before you configure anything

Read [`../docs/BUSY_INTEGRATION.md`](../docs/BUSY_INTEGRATION.md). It records
the connectivity audit and, importantly, the **site verification checklist**
that must be completed against the customer's actual BUSY installation.

The short version: **BUSY has no native public REST API.** The default
transport is BUSY's own XML Data Export/Import over a watched file exchange.
A REST gateway adapter exists for sites that have licensed one. Direct writes
to BUSY's SQL database are deliberately not implemented.

## Quick start

```bash
npm install
cp .env.example .env     # then fill it in — never commit .env
npm run build
npm start
```

Dashboard: `http://127.0.0.1:4010/dashboard`

```bash
npm test         # 85 tests: the 15 specified scenarios plus adapter,
                 # security, API and regression coverage
npm run typecheck
```

## How MES uses it

MES posts a commercial record and gets an immediate acknowledgement. It never
waits for BUSY and never learns anything about BUSY's transport.

```bash
curl -X POST http://127.0.0.1:4010/api/v1/mes/dispatches \
  -H 'X-Bridge-Key: <MES_API_KEY>' -H 'Content-Type: application/json' \
  -d '{
    "mesId": "DSP-91",
    "documentNumber": "DH-DSP-00091",
    "documentDate": "2026-09-16",
    "fiscalYear": "2026",
    "customerMesId": "CUST-00042",
    "lines": [{ "itemMesId": "FC-00125", "quantity": 500, "unit": "MTR", "rate": 180 }]
  }'
```

```json
{ "ok": true, "accepted": true, "externalReference": "DHOWN-DISPATCH-2026-000091",
  "status": "PENDING", "created": true, "busyReference": null }
```

`202` means the bridge has taken responsibility for the record. It does **not**
mean BUSY has booked it. MES collects the BUSY reference later:

```bash
curl http://127.0.0.1:4010/api/v1/mes/status/DHOWN-DISPATCH-2026-000091 \
  -H 'X-Bridge-Key: <MES_API_KEY>'
```

### MES routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/mes/customers` | Customer master |
| POST | `/api/v1/mes/vendors` | Vendor master |
| POST | `/api/v1/mes/items` | Item master |
| POST | `/api/v1/mes/warehouses` | Warehouse master |
| POST | `/api/v1/mes/sales-references` | Sales reference |
| POST | `/api/v1/mes/purchase-references` | Purchase reference |
| POST | `/api/v1/mes/dispatches` | Dispatch |
| POST | `/api/v1/mes/invoices` | Invoice / accounting reference |
| GET | `/api/v1/mes/status/:externalReference` | Status and BUSY reference |
| GET | `/api/v1/mes/entity/:type/:mesId` | Status by MES identity |
| GET | `/api/v1/mes/masters/:type` | BUSY → MES master sync |

Which of these are accepted is configurable via `ENABLED_ENTITY_TYPES`.
Anything not enabled is refused at the boundary rather than dropped quietly.

## Idempotency

Every transaction carries a deterministic external reference:

```
DHOWN-DISPATCH-2026-000091
```

Derived from the MES document number, so a resend — a retry, a double click, a
replayed webhook — produces the same key. A `UNIQUE` index enforces it in the
database, so two concurrent deliveries cannot both win.

Before creating anything in BUSY the bridge asks BUSY whether that reference
already exists. If it does, the existing BUSY reference is recovered and
reconciled; nothing is posted twice. This is what makes a crash between
"sent" and "recorded" safe.

## Offline mode

If BUSY is unreachable, **MES keeps running**. The worker detects the outage,
holds the queue without burning retry attempts, and drains it in order when
BUSY returns. A BUSY outage never stops factory production.

## Retry

Exponential backoff with jitter, and a finite budget:

```
Attempt 1 -> Attempt 2 -> Attempt 3 -> Attempt 4 -> MANUAL_REVIEW
```

Only transport-class failures retry. Bad data, missing mappings and BUSY
business rejections go straight to `MANUAL_REVIEW`, because retrying them
cannot help.

## Queue states

`PENDING` · `PROCESSING` · `AWAITING_BUSY` · `SUCCESS` · `FAILED` · `RETRY` ·
`MANUAL_REVIEW`

`AWAITING_BUSY` exists because the XML transport is asynchronous: the file has
been handed over but BUSY has not acknowledged it. Collapsing that into
`SUCCESS` would put a reference into MES that BUSY never issued.

## Dashboard

`/dashboard`, behind an admin key. Shows BUSY connection, last successful
sync, queue counts, today's transactions, mappings, reconciliation findings,
the audit trail and the adapter's capability matrix.

Per-transaction actions: **Retry**, **View Error**, **Fix Mapping**,
**Reconcile**, **View Payload**, **View BUSY Reference**. Reads need `viewer`;
every state-changing action needs `operator` or `admin`.

Errors are written for the person who has to fix them:

```
FAILED   Dispatch DH-DSP-00091
Reason:  MES item "FC-00125" is not mapped to a BUSY item.
Action:  Map MES item "FC-00125" to the matching BUSY item, then retry.
         [FIX MAPPING] [RETRY]
```

## Reconciliation

Compares MES and BUSY field by field — reference, party, item, quantity,
amount — and classifies each transaction as `MATCH`, `MISMATCH`,
`MISSING_IN_BUSY`, `MISSING_IN_MES` or `DUPLICATE`. Runs on a schedule and on
demand.

## Security

- BUSY credentials come from the environment, never from frontend code.
- No API response can carry a credential; `redactedConfig()` is the only
  config shape allowed out, and the logger redacts credential-shaped keys.
- API keys are compared in constant time.
- The dashboard is served with a restrictive CSP, loads no third-party assets
  and makes no external requests. Its key lives in `sessionStorage` only.
- **The customer portal must never talk to this service or to BUSY.** There is
  no route for it.

## Replacing the BUSY adapter

Everything BUSY-specific is behind `BusyAdapter` (`src/adapters/BusyAdapter.ts`).

1. Implement the interface.
2. Declare truthful `capabilities()` — operations the installation cannot
   perform must throw `UnsupportedOperationError`, never be faked.
3. Register it in `src/adapters/registry.ts`.
4. Set `BUSY_ADAPTER=<name>`.

No MES business logic, transformer, queue or reconciliation code should need
to change. If a new adapter forces a change outside `src/adapters/`, the
abstraction has leaked — fix that rather than work around it.

Shipped adapters: `xml` (default), `rest` (gateway, opt-in), `memory`
(test double; refused in production).

## Layout

```
src/
  adapters/      BusyAdapter contract + xml, rest, memory implementations
  api/           HTTP surface: auth, MES routes, admin routes, dashboard
  audit/         append-only audit trail
  db/            schema and connection
  domain/        MES types, external-reference (idempotency) keys
  mapping/       MES <-> BUSY master mapping
  queue/         queue store, retry policy, sync service, worker
  reconcile/     reconciliation engine
  transform/     MES -> BUSY XML
  validation/    payload validation
public/          dashboard (no build step, no dependencies)
test/            85 tests
```

## Known open item

The BUSY XML element names in `src/transform/busyXml.ts` follow the structure
described in the audit but have **not** been validated against a sample export
from the customer's own installation — checklist section 6.3 is still open.
That file is the only place that needs to change when real samples arrive.
