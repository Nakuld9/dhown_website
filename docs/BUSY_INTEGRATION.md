# BUSY Integration — Connectivity Audit & Selected Mechanism

**Status:** Desk audit complete. Environment verification **pending** — see
[Section 6](#6-site-verification-checklist). The checklist must be completed against the
customer's actual BUSY installation before the bridge is pointed at production.

**Scope:** How DHOWN MES exchanges *commercial* data with BUSY. Nothing in this document
applies to production planning, machine monitoring, WIP, roll tracking or AI scheduling —
those stay inside DHOWN MES and never leave it.

---

## 1. Why this document exists first

The instruction for this workstream was explicit: **do not assume a REST API exists.**

That caution is correct. BUSY (BUSY Infotech Pvt. Ltd., New Delhi) is a desktop/LAN
accounting product for the Indian SME market, not an API-first SaaS. The integration
surface it exposes depends on the **version**, the **edition**, and the **database
backend** the customer happens to be running. Writing transformation logic before those
three facts are pinned down is how integrations end up rewritten.

So the adapter layer is built to be **replaceable**, and this document records which
mechanism was selected and why.

---

## 2. What the audit found

### 2.1 There is no native public REST API

This is the single most important finding.

BUSY does not ship a documented, publicly supported REST API in its standard offline
editions. The evidence:

- The third-party vendors that sell "BUSY API" products describe themselves as *filling
  that gap* — BusyNotify states plainly that BUSY "does not provide a public REST API out
  of the box" and sells REST endpoints layered over the BUSY database.
- Unified-accounting-API aggregators (RootFi, Apideck) list Busy Accounting as an
  integration target they wrap, rather than as a vendor-documented API they call.
- BUSY's own published help material covers import/export and SQL connectivity. It does
  not document an HTTP API surface for third-party clients.

**Consequence:** any design that assumes `POST /api/v1/invoices` against BUSY is
fictional unless a gateway product has been licensed and installed. The bridge therefore
treats REST as *one possible transport among several*, never as the baseline.

### 2.2 Native, vendor-supported: XML Data Export / Import

BUSY ships a first-party **Data Export / Import** facility (Administration → Data
Export / Import) that works in **XML**, covering both **master types** (ledgers/accounts,
stock items, parties) and **voucher types** (sales, purchase, and other transactions),
with selectable type and date range.

Corroborating detail: BUSY's own `Tally2BUSY` migration utility consumes Tally XML exports
and writes ledgers, stock items and vouchers into a BUSY company — i.e. XML ingestion of
masters *and* transactions is a real, exercised code path inside the product, not a
marketing bullet.

This is the **only mechanism confirmed to be first-party, supported by the vendor, and
present across editions**. That makes it the default.

### 2.3 Also native: Excel / CSV import

BUSY supports importing from Excel and other programs, and exporting reports/documents to
Excel. Useful as a **fallback and for bulk master onboarding**, but weaker than XML for
transactional flow:

- column mapping is positional/by-template and brittle across versions,
- it is oriented at human-driven bulk loads, not per-transaction posting,
- it gives no natural place to carry an idempotency key.

Supported by the bridge as a master-loading convenience. **Not** used for dispatch/invoice
posting.

### 2.4 Conditionally available: direct MS SQL Server backend

BUSY is sold in SQL and non-SQL variants. SQL variants keep company data in **Microsoft
SQL Server**; BUSY's documentation covers SQL Server installation and SQL connectivity
troubleshooting, and SQL editions are marketed for larger/multi-user sites.

**Reading** from that database (for BUSY → MES master and outstanding sync) is a
legitimate, low-risk integration when the instance is reachable and a read-only login is
issued.

**Writing** to it is not. The schema is undocumented and version-dependent; direct INSERTs
bypass BUSY's own posting, numbering, GST and stock-valuation logic. Writing directly to
BUSY tables risks silent data corruption of a **statutory** system.

**Policy adopted here: SQL is read-only. All writes go through a supported BUSY ingestion
path.** This is enforced in code, not just in prose — see
`src/adapters/rest/BusyRestAdapter.ts` and the `capabilities()` contract.

### 2.5 Third-party REST gateways (optional, if licensed)

If the customer has licensed a gateway (BusyNotify-class product, or an in-house service
sitting on the BUSY SQL database), a genuine JSON/REST surface exists. Where present it is
the nicest option: synchronous, gives immediate references back, supports status queries.

The bridge supports this via a second adapter. It is **opt-in** and must never be assumed.

### 2.6 BUSY Online

BUSY also sells a cloud/online offering. If the customer is on BUSY Online rather than an
offline LAN install, the connectivity picture changes entirely and
[Section 6](#6-site-verification-checklist) must be re-run against that product.

### 2.7 Editions and variants that affect the answer

| Edition | Relevance to integration |
|---|---|
| Basic | Bookkeeping, invoicing, basic inventory, statutory reports. No order/challan management — **dispatch-challan mapping may not exist**. |
| Standard | Adds Order / Quotation / **Challan** management, multiple units, barcode/POS. This is the realistic minimum for the dispatch flow. |
| Enterprise | Adds multi-branch/location, voucher approval, payroll. Multi-location matters for warehouse mapping. |

Variants: Single-User, Dual-User, Multi-User, and (Standard/Enterprise) Client-Server.
Client-Server + SQL is what makes an always-available integration endpoint plausible;
a single-user desktop install means **BUSY is frequently offline**, which is precisely why
the queue and offline mode in this bridge are mandatory rather than defensive extras.

---

## 3. Mechanism selection

**Selected primary mechanism: BUSY XML Data Export / Import, over a watched file
exchange.**

Rationale:

1. It is first-party and vendor-supported, so it survives BUSY upgrades better than
   schema-level hacks.
2. It is present regardless of edition and regardless of SQL vs non-SQL backend.
3. It posts through BUSY's own import logic, so numbering, GST and stock valuation stay
   BUSY's responsibility — which is the entire point of BUSY being the statutory source of
   truth.
4. It is inherently asynchronous, which matches reality: a desktop accounting package is
   not an always-on API server.

**Selected fallback / upgrade path: REST gateway adapter**, enabled only when the customer
has a gateway licensed and reachable.

**Selected read path (optional): read-only SQL** for BUSY → MES master and outstanding
sync, where a read-only login is available.

### 3.1 How the file exchange works

```
  MES ──internal API──> BUSY BRIDGE ──writes──> <outbox>/DHOWN-DISPATCH-2026-000091.xml
                                                        |
                                    BUSY operator / scheduled BUSY import picks it up
                                                        ↓
                                              BUSY Data Import (XML)
                                                        |
                             BUSY writes result/ack ──> <ack>/DHOWN-DISPATCH-2026-000091.ack.xml
                                                        ↓
                        BRIDGE reads ack ──> stores BUSY reference ──> reconciles ──> MES
```

The outbox/ack directories are ordinary shared-folder paths on the BUSY LAN. The
filename **is** the external reference, which gives idempotency for free: the bridge
refuses to write a file whose external reference already exists, and a redelivery of the
same MES event resolves to the same filename.

### 3.2 Asynchrony is explicit

Because BUSY's import is not synchronous, `sendDispatch()` does **not** return a BUSY
reference under the XML adapter. It returns `ACCEPTED` plus the external reference.
The BUSY reference arrives later, via `getTransactionStatus()` polling the ack directory.
The queue models this as a distinct `AWAITING_BUSY` state so that "we handed it over" is
never confused with "BUSY booked it".

Under the REST adapter the same call *can* return a reference immediately. The MES-facing
API is identical either way — that difference is absorbed entirely inside the adapter.

---

## 4. Adapter capability matrix

`BusyAdapter.capabilities()` declares, at runtime, what the configured BUSY environment can
actually do. **Unsupported operations throw `UnsupportedOperationError`. They are never
faked, and never silently no-op.** The dashboard reads this matrix so operators can see
what this installation supports.

| Operation | XML file adapter | REST gateway adapter | Read-only SQL |
|---|---|---|---|
| `testConnection()` | ✅ directory reachability + writability | ✅ health endpoint | ✅ `SELECT 1` |
| `getCustomers()` | ⚠️ via scheduled BUSY export drop | ✅ | ✅ |
| `getVendors()` | ⚠️ via scheduled BUSY export drop | ✅ | ✅ |
| `getItems()` | ⚠️ via scheduled BUSY export drop | ✅ | ✅ |
| `createOrUpdateCustomer()` | ✅ master XML | ✅ | ❌ writes forbidden |
| `createOrUpdateVendor()` | ✅ master XML | ✅ | ❌ writes forbidden |
| `createOrUpdateItem()` | ✅ master XML | ✅ | ❌ writes forbidden |
| `sendSalesReference()` | ✅ voucher XML | ✅ | ❌ |
| `sendPurchaseReference()` | ✅ voucher XML | ✅ | ❌ |
| `sendDispatch()` | ✅ voucher XML (async) | ✅ | ❌ |
| `sendInvoice()` | ✅ voucher XML (async) | ✅ | ❌ |
| `getTransactionStatus()` | ✅ ack-file poll | ✅ | ✅ read |
| `reconcileTransaction()` | ⚠️ ack + export compare | ✅ | ✅ read |

✅ supported · ⚠️ supported but depends on a BUSY-side scheduled export being configured ·
❌ deliberately not implemented

The ⚠️ rows are the ones that need a BUSY-side operator action to configure. Until that is
done, `getCustomers()` under the XML adapter returns what is in the inbound drop directory
— which may legitimately be empty. That is reported as a capability gap on the dashboard,
not as a failure.

---

## 5. What is deliberately NOT integrated

MES remains the source of truth for production. The following are **never** sent to BUSY
and there is no code path that would:

- production planning and scheduling
- machine monitoring / OEE / downtime
- WIP state and shop-floor routing
- roll tracking and roll-level genealogy
- AI capacity calculation and optimisation
- customer portal sessions and portal logic

Conversely, accounting logic is **never** reimplemented inside MES. The bridge copies
BUSY's *references and outcomes* into MES; it does not recompute tax, valuation or ledger
balances.

---

## 6. Site verification checklist

**To be completed by whoever has access to the customer's BUSY installation.** Record the
answers here and commit them — these values drive `.env` and the adapter choice.

### 6.1 Version and edition

- [ ] BUSY version (Help → About): `____________` (e.g. BUSY 21 / BUSY 23 / BUSY Online)
- [ ] Release/build number: `____________`
- [ ] Edition: ☐ Basic ☐ Standard ☐ Enterprise
- [ ] Variant: ☐ Single-User ☐ Dual-User ☐ Multi-User ☐ Client-Server
- [ ] Offline LAN install or BUSY Online? `____________`
- [ ] Number of companies in BUSY, and which one is DHOWN's live book: `____________`
- [ ] Financial year / books-begin date: `____________`

> If edition is **Basic**, flag it: challan/order management may be absent and the dispatch
> flow may need to post as a direct sales voucher instead. Confirm before building mappings.

### 6.2 Database backend

- [ ] SQL edition? ☐ Yes ☐ No
- [ ] If yes — SQL Server version: `____________`
- [ ] SQL host/instance reachable from the bridge host? ☐ Yes ☐ No
- [ ] Read-only login issued for the bridge? ☐ Yes ☐ No — login name: `____________`
- [ ] Confirmed in writing that the bridge will **not** write to BUSY tables ☐

### 6.3 XML Data Export / Import

- [ ] Administration → Data Export / Import present in this edition? ☐ Yes ☐ No
- [ ] Master types exportable (list them): `____________`
- [ ] Voucher types importable (list them): `____________`
- [ ] **Sample XML captured** for each voucher type the bridge must post ☐
      → attach to `docs/samples/` — the transformer templates must be validated against
      real BUSY XML, not against this document's assumptions.
- [ ] Can BUSY import be scheduled/automated, or is it operator-driven? `____________`
- [ ] Shared folder path BUSY will read from (outbox): `____________`
- [ ] Shared folder path BUSY writes acks/exports to: `____________`
- [ ] Bridge host has read+write on those paths ☐

### 6.4 REST gateway (only if applicable)

- [ ] Gateway product licensed? ☐ Yes ☐ No — product/vendor: `____________`
- [ ] Base URL: `____________`
- [ ] Auth scheme: `____________`
- [ ] Endpoint documentation obtained ☐
- [ ] Rate limits: `____________`

### 6.5 Master data conventions

- [ ] BUSY customer/ledger code format: `____________`
- [ ] BUSY item code format: `____________`
- [ ] Warehouse/location feature in use? ☐ Yes ☐ No — list: `____________`
- [ ] GSTIN held per party in BUSY ☐
- [ ] Existing master export provided for initial mapping load ☐

### 6.6 Operational

- [ ] Hours BUSY is actually running (offline windows): `____________`
- [ ] Who owns BUSY-side errors (name/role): `____________`
- [ ] Backup/rollback procedure if a bad batch is imported: `____________`

---

## 7. Decision record

| Date | Decision | Basis |
|---|---|---|
| 2026-09-16 | REST is **not** assumed. XML Data Export/Import selected as primary. | No native public REST API found; XML is first-party and edition-independent. |
| 2026-09-16 | Direct SQL writes **forbidden**; SQL read-only where available. | Undocumented schema; writes bypass BUSY's statutory posting logic. |
| 2026-09-16 | `sendDispatch()` is async under XML; `AWAITING_BUSY` queue state added. | BUSY import is not a synchronous request/response. |
| 2026-09-16 | REST gateway supported as opt-in adapter. | Available only if the customer licenses one. |
| _pending_ | Final mechanism confirmed against live install. | Blocked on Section 6. |

---

## 8. Changing the mechanism later

The MES-facing contract does not change when the BUSY transport changes. To switch:

1. Implement `BusyAdapter` (see `src/adapters/BusyAdapter.ts`).
2. Declare truthful `capabilities()`.
3. Register it in `src/adapters/registry.ts`.
4. Set `BUSY_ADAPTER=<name>` in the environment.

No MES business logic, no transformer, no queue and no reconciliation code should need to
change. If a new adapter forces a change outside `src/adapters/`, that is a design bug —
the abstraction has leaked and should be fixed rather than worked around.

---

## 9. Sources

Desk research, September 2026:

- [BUSY — How do I import/export data in BUSY?](https://busy.in/faqs/how-do-i-importexport-data-in-busy-answerid-67737/)
- [BUSY — Import/export data from Excel or other programs](https://busy.in/faqs/how-do-i-importexport-data-from-excel-or-other-programs-into-busy-answerid-52182/)
- [BUSY — Supported formats for uploading existing data](https://busy.in/faqs/customize-exported-reports-documents-from-software-upload-existing-data-into-busy-what-formats-supported-answerid-28979/)
- [BUSY — System requirements / SQL version support](https://busy.in/faqs/does-it-integrate-with-different-sql-versions-answerid-45046/)
- [BUSY — SQL connectivity troubleshooting](https://busy.in/faqs/troubleshoot/sql-connectivity/6/)
- [BusyNotify — BUSY API integration (states BUSY has no public REST API out of the box)](https://busynotify.in/solutions/custom-apis)
- [RootFi — Busy Accounting integration](https://www.rootfi.dev/integrations/busy-accounting)
- [Apideck — Busy Accounting API](https://www.apideck.com/accounting-software/busy-accounting)
- [BUSY Infotech — Enterprise edition packages](https://www.busyinfotech.in/erp-software-packages.html)
- [BUSY edition comparison chart](https://busyaccountingsoftware.in/busy-software-comparison-chart.html)

> Vendor-neutral note: none of the above replaces Section 6. Published material describes
> the product family; only the customer's install describes the customer's install.
