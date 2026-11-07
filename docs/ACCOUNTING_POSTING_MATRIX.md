# Accounting Posting Matrix

How every business event becomes a balanced double-entry voucher. Account
**slots** are semantic; the actual account code per company comes from
`accounting_posting_rules` (configurable — nothing hardcoded). Default codes are
the seeded chart of accounts (`CHART_OF_ACCOUNTS.md`).

**Conventions**
- Dr = debit, Cr = credit. Every event below balances (Σ Dr = Σ Cr).
- GST is split CGST+SGST for **intra-state** and IGST for **inter-state**;
  rates come from the transaction's `tax_code`, never hardcoded.
- `posting_reference` is the idempotency key — one source event posts once.
- "Inventory valuation" uses the configured policy (FIFO / weighted average);
  the amount is computed by the inventory module, the posting is as below.

Legend for status: ✅ engine + rule verified by tests · ⏳ engine ready, business
module lands the event in a later stage.

---

## 1. Purchase invoice — chemicals/yarn on credit (PI) ✅
Example: value ₹100,000; intra-state GST 18% → CGST 9,000 + SGST 9,000.

| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | inventory (chemical/yarn) | 1100 / 1060 | taxable value |
| Dr | input_cgst | 1121 | CGST |
| Dr | input_sgst | 1122 | SGST |
| Dr | input_igst (inter-state only) | 1123 | IGST |
| Cr | supplier_payable (AP control) | 2010 | gross |

`posting_reference = PI:<invoice_no>` · voucher type **PI**

## 2. Chemical / dye consumption in a dye bath (PJ) ✅
Actual accepted consumption only (accepted dispensing transaction), costed by
inventory policy.

| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | wip_chemical / wip_dye | 1080 | actual consumption cost |
| Cr | chemical_inventory / dye_inventory | 1100 / 1090 | same |

`posting_reference = BATH:<bath_id>:consume:<txn_id>` · type **PJ**
Correction dosing posts a **separate** voucher
(`...:correction:<n>`) — originals are never overwritten (TEST 10). ✅

## 3. Expense bill with GST — e.g. electricity (PI/JV) ✅
| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | expense | 5070 (electricity) | bill value |
| Dr | input_cgst / input_sgst / input_igst | 1121/1122/1123 | GST |
| Cr | expense_payable / supplier_payable | 2020 / 2010 | gross |

## 4. Sales invoice with GST (SI) ✅
Example: sale ₹200,000 + GST 36,000.

| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | customer_receivable (AR control) | 1040 | gross |
| Cr | sales_income | 4010 | taxable value |
| Cr | output_cgst / output_sgst | 2041 / 2042 | GST (intra) |
| Cr | output_igst | 2043 | GST (inter) |

`posting_reference = SI:<invoice_no>` · type **SI**

## 5. Customer receipt (RV) ✅
| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | bank / cash | 1020 / 1010 | received |
| Cr | customer_receivable | 1040 | received |

## 6. Supplier payment (PV) ✅
| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | supplier_payable | 2010 | paid |
| Cr | bank / cash | 1020 / 1010 | paid |

## 7. Production cost transfer WIP → Finished Goods (SJ) ✅
| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | finished_goods_inventory | 1085 | production cost |
| Cr | work_in_progress | 1080 | same |

## 8. Cost of goods sold on sale (SJ) ✅
| Dr/Cr | Slot | Default acct | Amount |
|---|---|---|---|
| Dr | cost_of_goods_sold | 5150 | COGS |
| Cr | finished_goods_inventory | 1085 | COGS |

## 9. Bank charges (PV) ✅
| Dr | bank_charges | 6100 |
| Cr | bank | 1020 |

---

## Remaining configured events

Implemented and tested since Stage 2–4 (via `app/services/*` and
`accounting_posting_rules`): **Chemical GRN** (`CHEMICAL_GRN`), **Yarn issue**
(`YARN_ISSUE`), **Knitting production → greige** (`KNITTING_PRODUCTION`),
**Dispensing consumption** (`CHEMICAL_CONSUMPTION`/`DYE_CONSUMPTION`), **Sales
invoice** (`SALES_INVOICE`). The rest below are engine-ready ⏳.

| Event | Voucher | Dr → Cr (slots) |
|---|---|---|
| Chemical/Yarn GRN ✅ | PI | inventory + input_gst → supplier_payable |
| Yarn issue to knitting ✅ | PJ | wip → yarn_inventory |
| Knitting production → greige ✅ | PJ | greige_inventory → wip |
| Dispensing consumption ✅ | PJ | wip → chemical/dye_inventory |
| Sales invoice ✅ | SI | receivable → sales + output_gst |
| Purchase return | DN | supplier_payable → inventory + input_gst_reversal |
| Sales return / credit note | CN | sales_income + output_gst → customer_receivable |
| Debit note (supplier) | DN | supplier_payable → expense/inventory adj |
| Bank receipt / payment (non-party) | RV/PV | bank ↔ income/expense |
| Contra (cash⇄bank, bank⇄bank) | CV | bank/cash → bank/cash |
| Freight inward | PI/JV | freight (or inventory) + input_gst → payable |
| Payroll | PRV | salaries/direct_labour → salary_payable + tds_payable |
| Depreciation | DEP | depreciation_expense → accumulated_depreciation |
| Stock adjustment (approved) | SJ | inventory ↔ stock_adjustment (controlled workflow) |
| Manufacturing overhead allocation | PJ | wip (per cost centre) → overhead_absorbed |
| GST set-off (period end) | GADJ | output_gst → input_gst + gst_payable |
| Opening balances | OB | per-account Dr/Cr (must balance) |

Each becomes a row-set in `accounting_posting_rules` and a thin event handler
that builds a `PostingRequest`. The engine guarantees the invariants regardless
of which handler calls it.

---

## Invariants the engine enforces (brief §19)

1. Σ Dr = Σ Cr on every posted voucher, else nothing commits. ✅ (tests)
2. Each line is one-sided and non-negative. ✅
3. Posted lines/vouchers are immutable (ORM guard). ✅
4. Corrections only via reversal vouchers. ✅
5. Every voucher links to its source (`source_module`, `source_id`). ✅
6. Unique posting identity per event (`posting_reference`). ✅
7. Duplicate posting prevented (idempotent return). ✅
8. Atomic posting inside one DB transaction. ✅
9. Unbalanced journals cannot commit. ✅
10. Sub-ledgers via `party_type`/`party_id` + control accounts. ✅ (structure)
11–12. Inventory & GST reconcile with the GL. ⏳ (reports land with modules)
13. Closed periods block posting. ✅
14. Complete audit trail. ✅
15. Approvals via permission codes + `requires_approval` voucher flag. ✅/⏳
16–19. Decimal precision, configurable rounding, no floats, decimal storage. ✅
20. Multi-company isolation by `company_id`. ✅
