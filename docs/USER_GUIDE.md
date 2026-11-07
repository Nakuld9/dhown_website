# User & Administrator Guide

How to run the business in the Textile ERP. The web UI is at `/app/`; every
screen talks to the same REST API documented at `/docs`.

---

## Part A — Administrator guide

### A1. First-time setup
1. Sign in as the seeded admin (change the password immediately — see
   `DEPLOYMENT.md` §4).
2. The seeder creates a demo company, the full **chart of accounts**, **14
   voucher types**, **accounting periods** for the current Indian financial
   year, **15 roles**, and **posting rules**. For a real company, create your
   own company record and chart-of-accounts values as needed (the seeded ones
   are a ready template).
3. Create the master data you will transact against: tax codes, chemicals/dyes
   and their lots, yarn, fabric types, machines, shades, recipes (and approve a
   recipe version), warehouses, customers and suppliers. Warehouses, customers
   and suppliers have UI screens; the rest are available via the API (`/docs`)
   or the demo seeder.

### A2. Users, roles and permissions
Access is permission-based. The 15 seeded roles (Owner, Accountant, Finance
Controller, Production Manager, Dyeing Supervisor, Lab Technician, Chemical
Store Manager, Dispensing Operator, Purchase Manager, Auditor, …) each grant a
set of permission codes (e.g. `voucher.post`, `recipe.approve`,
`quality.manage`). Key controls, enforced in-app:

- Operators cannot modify approved recipes or posted dispensing records.
- Posting, approving, reversing vouchers and closing periods are separate
  permissions.
- **Posted ledger entries are immutable** — corrections are made only through
  reversal vouchers.

### A3. Accounting periods & year-end
Postings are only allowed into an **OPEN** period; posting into a **CLOSED**
period is blocked. Close a period once reconciled; reopening requires an
authorised permission. The financial year runs April–March.

### A4. Configurable posting rules
Each business event (GRN, sales invoice, dispensing consumption, …) maps to
account codes via `accounting_posting_rules`, seeded with sensible defaults and
editable per company. The chart of accounts and GST rates are **data, never
hardcoded**. See `ACCOUNTING_POSTING_MATRIX.md`.

### A5. Color Service dispensing
Dispensing runs against a **simulator** until a verified vendor adapter is
configured (see `COLOR_SERVICE_INTEGRATION.md`). Do not represent simulated
dispensing as real production until the adapter is validated.

---

## Part B — User guide (by workflow)

The sidebar groups screens into **Dashboards · Transactions · Masters · Quality ·
Costing · Reports**.

### B1. Purchase chemicals/dyes — Transactions → Purchase (GRN)
Pick the supplier, add lines (chemical, warehouse, quantity, unit cost, tax
code), and **Post GRN**. This adds costed FIFO stock and posts a GST purchase
voucher (inventory + input CGST/SGST/IGST → supplier payable). The result shows
the voucher number and total.

### B2. Knit fabric — Transactions → Knitting
Choose machine and yarn, enter produced/consumed/wastage kg, add greige roll(s)
with weights, and **Record production**. Yarn is issued FIFO (costed), greige
rolls are created and traceable to the run, and the WIP/greige postings are
made. Link a sales order to carry the demand through to costing.

### B3. Dye & dispense — Transactions → Dyeing & Dispensing
1. **Create batch** (code, fabric kg, shade).
2. **Add bath** (machine, an **approved** recipe version, fabric kg).
3. **Preview dose order** — the recipe scaled to the bath weight (e.g. 250 kg ×
   1.4 % = 3.5 kg).
4. **Simulate dispensing** — receives actuals, records an immutable per-bath
   transaction for each material, consumes stock **exactly once**, and posts
   Dr WIP / Cr inventory.
5. The **bath consumption register** shows recipe vs actual, variance and cost.
Correction dosing posts a *separate* transaction; replays never double-count.

### B4. Invoice the customer — Transactions → Sales Invoice
Pick the customer, add lines (description, qty, rate, tax code), and **Post
invoice**. Posts receivable + sales + output GST; the result shows taxable, tax
and total.

### B5. Receipts, payments & bank reconciliation (API / `/docs`)
Record customer receipts, supplier payments and contra entries; import a bank
statement CSV and reconcile it against the bank ledger (auto-match by amount and
date, with outstanding items listed). Endpoints under `/api/banking/*`.

### B6. Quality & finishing — Quality
Record **inspections** (Delta E, shade match, fastness) — the result is
auto-graded accept/rework/reject and updates the roll status. Record
**finishing** processes (shrinkage auto-computed; a finishing process marks the
roll finished). Log and resolve **customer complaints**. KPI cards show the
rejection rate and open complaints.

### B7. Costing & profitability — Costing
See cost per kg (knitted/dyed), **customer** and **order profitability** (revenue
− actual yarn + dyeing cost → gross profit and margin), machine- and shade-wise
cost, and standard-vs-actual variance per bath. All from actually-posted
consumption and revenue.

### B8. Dashboards
- **Owner** — revenue, gross/net profit, cash & bank, receivables, payables,
  inventory value, sales trend.
- **Factory** — knitting/dyeing output, active batches, chemical cost.
- **Accounts** — today's receipts/payments, bank balances, debtors/creditors,
  GST payable, trial-balance status.
- **Chemical** — dye/chemical cost, top consumption, stock alerts, dispensing
  errors.

### B9. Reports — Reports
Download **Excel** or **PDF** for trial balance, P&L, Balance Sheet, cash flow,
debtor/creditor ageing, GST registers, GSTR-3B, and stock-vs-GL reconciliation.

---

## Part C — Daily/period routine (suggested)

- **Daily:** post the day's GRNs, knitting, dyeing/dispensing and sales; record
  receipts/payments; check the Accounts dashboard.
- **Weekly:** import and reconcile bank statements; review the Chemical and
  Quality dashboards; review order/customer profitability.
- **Month-end:** reconcile stock-vs-GL and GST (books vs registers), review the
  trial balance, generate P&L and Balance Sheet, then close the period.

If the trial balance does not balance or a reconciliation shows a difference,
stop and investigate before closing — by design these should always tie out.
