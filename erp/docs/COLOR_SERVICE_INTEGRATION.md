# Color Service Dispensing Integration — Specification

> **Status: PENDING VENDOR VERIFICATION — not production-ready.** No live Color
> Service API, protocol or schema is assumed or invented here. This document
> defines the ERP-side contract, an adapter abstraction, and a **simulator** so
> development and the end-to-end tests proceed without vendor hardware. Before
> any production use, the concrete adapter must be validated against the
> **installed** Color Service Supervisor version and its licensed interface.

## 1. Guiding rules (from the brief)

- Do **not** invent vendor APIs/protocols. Verify the available, vendor-supported
  interface first.
- Prioritise **official** interfaces over database/file scraping.
- Integration is **two-way**: ERP → Color Service (recipe/dose instructions) and
  Color Service → ERP (actual dispensing results).
- Every dye bath keeps an **immutable** actual-consumption register.
- Accepted consumption posts to inventory and accounting **exactly once**
  (idempotency). Correction dosing creates **new** transactions; nothing is
  overwritten.
- Provide offline sync, retry queues, error logs, reconciliation, audit trails.

## 2. Candidate interfaces (to be verified, in priority order)

| Priority | Interface | When to use | Verify |
|---|---|---|---|
| 1 | Official Color Service API (REST/SOAP) | if licensed & documented | endpoints, auth, schemas, version |
| 2 | Vendor-supported database views | if vendor sanctions read access | which tables/views are supported & stable |
| 3 | XML / CSV file exchange (watched folders) | common on dosing lines | file schema, encoding, drop/ack convention |
| 4 | OPC UA | PLC-level process values | node IDs, security policy |
| 5 | Modbus TCP / PLC gateway | last resort, where exposed | register map, scaling, units |

Each becomes a concrete implementation of the adapter interface below. The ERP
core depends only on the abstraction, so swapping/validating an interface does
not touch business logic.

## 3. Adapter abstraction (ERP-side contract)

```
class ColorServiceAdapter(Protocol):
    def send_dose_order(self, order: DoseOrder) -> SendAck: ...
    def fetch_results(self, since: datetime) -> list[DispenseResult]: ...
    # push adapters instead deliver DispenseResult via a webhook/file-watch
    # that normalises to the same DispenseResult.
```

- **ERP → Color Service** (`DoseOrder`): `batch_id`, `bath_id`, `machine`,
  `fabric_kg`, `shade`, `recipe_id`, `recipe_revision`, and per-material
  `{material_code, dye_code, target_qty, unit, dosing_sequence}`. Sent only for
  **approved** recipe versions.
- **Color Service → ERP** (`DispenseResult`): `external_txn_id` (idempotency
  key), `batch_id`, `bath_id`, `machine_id`, `material_code`, `chemical_lot`,
  `target_weight`, `actual_weight`, `unit`, `started_at`, `completed_at`,
  `operator`, `dispenser_id`, `scale_id`, `dosing_status`
  (OK / FAILED / REPEATED / ADDITIONAL).

The canonical ERP schemas are vendor-neutral; each adapter maps the vendor
payload onto them. **Units are normalised** to ERP base units on ingress.

## 4. Individual bath consumption register

For each `dye_bath`, accepted `DispenseResult`s are stored immutably in
`dispensing_transactions`. The register yields, per material:
`recipe target`, `actual`, `variance`, `chemical cost`, `dye cost`,
`consumption per kg`, and the **total bath cost** — exactly the worked example in
brief §10 (Batch DY-26001 / Bath DY-26001-B01).

Correction/additional dosing is recorded in `dispensing_corrections` and as new
`dispensing_transactions` with their own `external_txn_id`, carrying reason,
material, quantity, approver, operator, timestamp and dispensing reference.

## 5. Idempotency, inventory & accounting

```
DispenseResult (status accepted)
  └─ upsert dispensing_transactions on UNIQUE(external_txn_id)   # dedupe
        └─ create ONE inventory consumption movement (FIFO/FEFO, by lot)
              └─ posting_engine.post_voucher(
                     ref = "BATH:<bath_id>:consume:<external_txn_id>",
                     Dr WIP (chemical/dye cost) / Cr Chemical|Dye Inventory)
```

- The DB `UNIQUE(external_txn_id)` plus the voucher `posting_reference` give
  **two independent idempotency barriers**. Reconnecting the feed or replaying a
  file never double-counts (acceptance TEST 18).
- **Transfer to a dispensing tank is not consumption.** Tank refills move stock
  between locations (store → dispensing tank) and never hit WIP; only accepted
  dosing against a bath is actual consumption.

## 6. Resilience

- **Inbound queue** (`integration_events`): raw vendor payloads are persisted
  first, then processed; processing is retried with backoff and is safe to
  replay (idempotent).
- **Offline**: file/DB adapters poll a watermark (`since`); API push adapters
  persist to the queue on receipt. A gap is healed by re-fetching from the last
  processed watermark.
- **Errors**: unmapped materials, missing lots, or out-of-tolerance variances
  are flagged for review rather than silently posted.
- **Reconciliation**: per-bath expected-vs-dispensed and per-day
  store-vs-dispensing-tank-vs-machine stock reconciliations.
- **Audit**: every inbound event, mapping decision and posting is logged.

## 7. Development simulator (ships with the ERP)

`ColorServiceSimulator` implements `ColorServiceAdapter` and:
- accepts `DoseOrder`s and generates realistic `DispenseResult`s (actuals jittered
  around targets within tolerance, occasional FAILED/REPEATED, optional
  ADDITIONAL correction),
- assigns stable `external_txn_id`s so idempotency/replay can be tested,
- lets the Stage 4 end-to-end tests run with no vendor hardware.

The simulator is clearly labelled non-production and is never used when a
verified adapter is configured.

## 8. Verification checklist (before production)

- [ ] Confirm the installed Color Service Supervisor version and licensed
      interface with the vendor.
- [ ] Obtain official schema/endpoint/register documentation.
- [ ] Implement and unit-test the concrete adapter against a vendor test rig.
- [ ] Validate unit conversions and material-code mapping on real recipes.
- [ ] Run a controlled bath and reconcile register vs. physical weights.
- [ ] Sign-off; only then disable the simulator in that environment.

Until every box is ticked, the integration is reported as **pending**, per the
brief's instruction not to claim it production-ready without verification.
