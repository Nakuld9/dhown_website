# Database ER Diagram

> Entities marked _(planned)_ are specified here for the full design and are
> created in later stages. All **implemented** tables exist in the ORM
> (`backend/app/models`) and the baseline migration.

## 1. The master traceability chain (brief §18)

Every physical and financial fact must be traceable end to end:

```
Sales Order
   └─▶ Yarn Issue ─▶ Knitting Production ─▶ Greige Rolls
          └─▶ Dye Batch ─▶ Dye Bath ─▶ Approved Recipe (version)
                 └─▶ Color Service Dispensing Transactions ─▶ Chemical Lot
                        └─▶ Chemical Inventory Consumption
                               └─▶ Manufacturing WIP ─▶ Finished Goods
                                      └─▶ Sales Invoice ─▶ General Ledger
```

Each arrow is a foreign key (or a posting reference, for the GL hop). A finished
roll can therefore be walked back to its order, yarn lot, machine, batch, bath,
chemical lot and the exact vouchers that costed it (acceptance TEST 20).

## 2. Implemented schema (Stage 1)

```mermaid
erDiagram
    COMPANIES ||--o{ BRANCHES : has
    COMPANIES ||--o{ DEPARTMENTS : has
    COMPANIES ||--o{ EMPLOYEES : employs
    COMPANIES ||--o{ CHART_OF_ACCOUNTS : owns
    COMPANIES ||--o{ ACCOUNTING_PERIODS : owns
    COMPANIES ||--o{ VOUCHERS : owns
    COMPANIES ||--o{ CUSTOMERS : has
    COMPANIES ||--o{ SUPPLIERS : has

    USERS }o--o{ ROLES : user_roles
    ROLES }o--o{ PERMISSIONS : role_permissions
    USERS }o--|| COMPANIES : belongs_to

    CHART_OF_ACCOUNTS ||--o{ CHART_OF_ACCOUNTS : parent_of
    VOUCHER_TYPES ||--o{ VOUCHERS : classifies
    ACCOUNTING_PERIODS ||--o{ VOUCHERS : contains
    VOUCHERS ||--o{ JOURNAL_LINES : has
    CHART_OF_ACCOUNTS ||--o{ JOURNAL_LINES : posted_to
    COST_CENTRES ||--o{ JOURNAL_LINES : tagged
    VOUCHERS ||--o| VOUCHERS : reversal_of

    CHART_OF_ACCOUNTS {
        uuid id PK
        uuid company_id FK
        string code
        string name
        string account_type
        uuid parent_id FK
        bool is_group
        bool allow_posting
        bool is_control
    }
    VOUCHERS {
        uuid id PK
        uuid company_id FK
        uuid voucher_type_id FK
        uuid period_id FK
        string number
        date voucher_date
        string status
        string posting_reference "unique per company"
        uuid reversal_of_id FK
        numeric total_debit
        numeric total_credit
    }
    JOURNAL_LINES {
        uuid id PK
        uuid voucher_id FK
        int line_no
        uuid account_id FK
        uuid cost_centre_id FK
        numeric debit
        numeric credit
        string party_type
        uuid party_id
    }
    ACCOUNTING_PERIODS {
        uuid id PK
        uuid company_id FK
        string code
        string fiscal_year
        date start_date
        date end_date
        string status "OPEN/CLOSED"
    }
```

### Master data (implemented)

```mermaid
erDiagram
    CHEMICALS ||--o{ CHEMICAL_LOTS : batched_as
    CHEMICAL_CATEGORIES ||--o{ CHEMICALS : groups
    SUPPLIERS ||--o{ CHEMICAL_LOTS : supplied
    UNITS_OF_MEASURE ||--o{ CHEMICALS : measured_in
    TAX_CODES ||--o{ CHEMICALS : taxed_by
    SHADE_CODES ||--o{ RECIPES : for_shade
    FABRIC_TYPES ||--o{ RECIPES : for_fabric
    RECIPES ||--o{ RECIPE_VERSIONS : versioned
    RECIPE_VERSIONS ||--o{ RECIPE_MATERIALS : contains
    CHEMICALS ||--o{ RECIPE_MATERIALS : used_in
    COST_CENTRES ||--o{ MACHINES : costed_to
    WAREHOUSES ||--o{ CHEMICAL_LOTS : stored_in

    CHEMICALS {
        uuid id PK
        string code "Color Service material code"
        string name
        bool is_dye
        string dye_class
        numeric standard_cost
    }
    RECIPE_VERSIONS {
        uuid id PK
        uuid recipe_id FK
        int version_no
        numeric liquor_ratio
        string status "DRAFT/APPROVED/REVISED"
        uuid approved_by
    }
    RECIPE_MATERIALS {
        uuid id PK
        uuid version_id FK
        uuid chemical_id FK
        int sequence
        numeric percent_owf
        numeric grams_per_kg
    }
```

## 3. Planned transactional schema (Stages 2–5)

These tables complete the traceability chain. Keys shown are the spine; full
column lists are defined as each stage is built.

```mermaid
erDiagram
    SALES_ORDERS ||--o{ KNITTING_PRODUCTION : drives
    YARN_MASTERS ||--o{ KNITTING_PRODUCTION : consumes
    MACHINES ||--o{ KNITTING_PRODUCTION : on
    KNITTING_PRODUCTION ||--o{ FABRIC_ROLLS : produces
    FABRIC_ROLLS }o--o{ DYE_BATCHES : batched_into
    DYE_BATCHES ||--o{ DYE_BATHS : split_into
    MACHINES ||--o{ DYE_BATHS : dyed_on
    RECIPE_VERSIONS ||--o{ DYE_BATHS : approved_recipe
    DYE_BATHS ||--o{ DISPENSING_TRANSACTIONS : dispensed_in
    DISPENSING_DEVICES ||--o{ DISPENSING_TRANSACTIONS : from
    CHEMICAL_LOTS ||--o{ DISPENSING_TRANSACTIONS : drawn_from
    DISPENSING_TRANSACTIONS ||--o{ DISPENSING_CORRECTIONS : corrected_by
    DISPENSING_TRANSACTIONS ||--o{ INVENTORY_TRANSACTIONS : consumes
    INVENTORY_TRANSACTIONS }o--|| VOUCHERS : posts

    DYE_BATHS {
        uuid id PK
        uuid batch_id FK
        uuid machine_id FK
        uuid recipe_version_id FK
        string bath_id "e.g. DY-26001-B01"
        numeric fabric_kg
        numeric liquor_ratio
    }
    DISPENSING_TRANSACTIONS {
        uuid id PK
        uuid bath_id FK
        uuid chemical_id FK
        uuid chemical_lot_id FK
        string external_txn_id "idempotency key"
        numeric target_weight
        numeric actual_weight
        string dosing_status
        datetime completed_at
    }
```

## 4. Control & audit (implemented)

```mermaid
erDiagram
    AUDIT_LOGS {
        uuid id PK
        datetime at
        uuid actor_id
        string action "POST/REVERSE/CREATE/LOGIN"
        string entity
        string entity_id
        string detail "JSON before/after"
    }
    DOCUMENT_SEQUENCES {
        uuid id PK
        uuid company_id
        string doc_type
        string fiscal_year
        string prefix
        int next_number
    }
    ACCOUNTING_POSTING_RULES {
        uuid id PK
        uuid company_id
        string event_type
        string role "semantic slot"
        string account_code
    }
```

## 5. Notes on modelling choices

- **Machines**: knitting/dyeing/finishing are one `machines` table keyed by
  `machine_type`, not three near-identical tables — uniform scheduling,
  downtime and cost-centre linkage. The spec's three logical tables are views
  (filters) over it.
- **Chemicals & dyes** share one `chemicals` master (`is_dye` flag) so recipes,
  lots, dispensing and inventory treat them uniformly.
- **Sub-ledgers**: customer/supplier/inventory sub-ledgers are `journal_lines`
  tagged with `party_type`/`party_id` plus control-account flags on the chart of
  accounts, so the GL and sub-ledgers reconcile by construction.
