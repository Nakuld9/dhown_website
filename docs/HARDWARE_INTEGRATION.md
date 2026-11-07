# Shop-floor Hardware Integration — Weighing Scales & Knitting Machines

> **Status: PENDING VENDOR VERIFICATION — simulator-only.** As with the Color
> Service integration, no vendor protocol is assumed or invented. The ERP
> exposes a vendor-neutral contract and ships a **simulator**; a concrete device
> adapter must be validated against the real scales / machine controllers before
> production use. Do not represent simulated readings as real production.

## 1. What is integrated

| Device | Captured | ERP use |
|---|---|---|
| **Weighing scale** | stable weight readings (kg), optionally tied to a roll or dye bath | roll weighing, dispensing weight verification, traceability |
| **Knitting machine monitor** | status (running/stopped), production (kg), rpm, run/downtime minutes, stop reason | machine efficiency, downtime analysis, factory dashboard |

Both follow the same resilient pattern: a gateway (or the simulator) delivers
messages that each carry a **stable external id**; ingest is idempotent on that
id, so reconnect/replay never duplicates.

## 2. Canonical messages (vendor-neutral)

```
ScaleReadingMsg  = { external_reading_id, scale_code, weight, unit, stable,
                     reference_type (ROLL|BATH), reference_id, operator, captured_at }
KnittingLogMsg   = { external_log_id, machine_code, status, produced_kg, rpm,
                     run_minutes, downtime_minutes, stop_reason, operator, log_time }
```

Concrete adapters map a vendor payload onto these; the ERP core depends only on
these shapes. Candidate interfaces to verify (priority order): official device
API/SDK → vendor-sanctioned database/file export → OPC UA → Modbus TCP / PLC
gateway → serial scale indicator (RS-232/USB, continuous or request mode).

## 3. Adapter contract

```
class WeighingScaleAdapter(Protocol):
    def fetch_readings(self) -> list[ScaleReadingMsg]: ...
class KnittingMachineAdapter(Protocol):
    def fetch_logs(self) -> list[KnittingLogMsg]: ...
```

Push adapters (a gateway POSTing to the ingest endpoints) and pull adapters
(polling a watermark) both normalise to these messages. Units are normalised to
ERP base units on ingress.

## 4. Ingest, idempotency & reconciliation

- `scale_readings` is unique on `(company, external_reading_id)`;
  `machine_process_logs` is unique on `(company, external_log_id)` — the first
  idempotency barrier.
- Readings link to a roll/bath for traceability; they do **not** silently mutate
  costed inventory (weighing is recorded, not re-valued) to keep the stock
  sub-ledger and GL in agreement.
- Knitting logs aggregate into a machine **efficiency** summary
  (`run / (run + downtime)`), produced kg and stop counts, feeding the Factory
  dashboard.

## 5. Endpoints

```
POST /api/hardware/scale-readings        # ingest (gateway)
GET  /api/hardware/scale-readings        # recent readings
POST /api/hardware/simulate/scale        # DEV: simulate a capture
POST /api/hardware/knitting-logs         # ingest (gateway)
POST /api/hardware/simulate/knitting     # DEV: simulate monitoring
GET  /api/hardware/knitting-summary      # per-machine efficiency
GET/POST /api/hardware/scales            # weighing-scale master
```

The UI **Devices & Labels** page drives the simulators and shows the summaries.

## 6. Roll labels

Every fabric roll can print a **label (PDF) with a QR code** encoding the roll
number, plus roll no., kind, quality, fabric, weight, length, GSM, width and dye
batch: `GET /api/rolls/{id}/label`. A scan at any station resolves the roll, so
the same code drives weighing capture, dyeing batching and dispatch.

## 7. Verification checklist (before production)

- [ ] Confirm each device's supported interface with the vendor.
- [ ] Implement + unit-test the concrete adapter against a test rig.
- [ ] Validate unit conversions and the stable-reading criterion for scales.
- [ ] Validate machine counters/downtime mapping against the controller.
- [ ] Reconcile a weighed roll and a monitored shift against physical records.
- [ ] Sign-off; only then disable the simulator in that environment.
