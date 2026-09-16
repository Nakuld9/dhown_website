/**
 * DHOWN BUSY BRIDGE schema.
 *
 * Kept as a TypeScript module rather than a .sql file so the compiled package
 * is self-contained — no build step has to remember to copy an asset, and the
 * schema can never go missing at runtime.
 *
 * Every statement is idempotent (CREATE ... IF NOT EXISTS), so opening an
 * existing database is also the migration step.
 */

export const SCHEMA_SQL = `
-- ---------------------------------------------------------------------------
-- DHOWN BUSY BRIDGE schema
--
-- This database holds ONLY integration state: mappings, the outbound queue,
-- the audit trail and reconciliation results. It is not a copy of MES and not
-- a copy of BUSY's books.
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- --- MASTER MAPPING --------------------------------------------------------
-- One row per MES master record per entity type. IDs are never assumed equal
-- between the two systems, so every reference crosses this table.
CREATE TABLE IF NOT EXISTS busy_master_mapping (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type     TEXT    NOT NULL CHECK (entity_type IN
                    ('CUSTOMER','VENDOR','ITEM','WAREHOUSE','TRANSACTION')),
  mes_id          TEXT    NOT NULL,
  busy_id         TEXT,
  busy_code       TEXT,
  sync_status     TEXT    NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN
                    ('PENDING','SYNCED','FAILED','MANUAL_REVIEW')),
  last_synced_at  TEXT,
  error           TEXT,
  mes_name        TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, mes_id)
);

-- A BUSY record must not be claimed by two different MES records: that would
-- silently merge two customers' ledgers. Partial index so unmapped rows
-- (busy_id NULL) do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS ux_master_mapping_busy
  ON busy_master_mapping (entity_type, busy_id)
  WHERE busy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_master_mapping_status
  ON busy_master_mapping (sync_status);

-- --- SYNC QUEUE ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS busy_sync_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type         TEXT    NOT NULL,
  mes_entity_id       TEXT    NOT NULL,
  operation           TEXT    NOT NULL,
  payload             TEXT    NOT NULL,              -- JSON, exactly as MES sent it
  payload_version     INTEGER NOT NULL DEFAULT 1,
  external_reference  TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN
                        ('PENDING','PROCESSING','AWAITING_BUSY','SUCCESS','FAILED','RETRY','MANUAL_REVIEW')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at     TEXT,
  next_retry_at       TEXT,
  busy_reference      TEXT,
  error_code          TEXT,
  error_message       TEXT,
  -- Classified error details as JSON (subject, entity type, BUSY response).
  -- Kept structured so the dashboard can rebuild the operator's remediation
  -- message faithfully instead of re-deriving it from prose.
  error_details       TEXT,
  created_by          TEXT    NOT NULL DEFAULT 'MES',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- THE idempotency guarantee. Enforced by the database so that two workers, or
-- two concurrent MES deliveries, cannot both create the same BUSY transaction.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sync_queue_external_ref
  ON busy_sync_queue (external_reference);

CREATE INDEX IF NOT EXISTS ix_sync_queue_claim
  ON busy_sync_queue (status, next_retry_at);
CREATE INDEX IF NOT EXISTS ix_sync_queue_entity
  ON busy_sync_queue (entity_type, mes_entity_id);
CREATE INDEX IF NOT EXISTS ix_sync_queue_created
  ON busy_sync_queue (created_at);

-- --- AUDIT -----------------------------------------------------------------
-- Append-only. An integration failure is never silently discarded; it lands
-- here even when the queue row moves on.
CREATE TABLE IF NOT EXISTS busy_audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id            INTEGER REFERENCES busy_sync_queue(id) ON DELETE SET NULL,
  entity_type         TEXT    NOT NULL,
  mes_entity_id       TEXT    NOT NULL,
  external_reference  TEXT,
  operation           TEXT    NOT NULL,
  payload_version     INTEGER NOT NULL DEFAULT 1,
  payload_snapshot    TEXT,                          -- what we actually sent
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  actor               TEXT    NOT NULL DEFAULT 'system',
  busy_response       TEXT,
  busy_reference      TEXT,
  final_status        TEXT    NOT NULL,
  error_code          TEXT,
  error_message       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_audit_queue   ON busy_audit_log (queue_id);
CREATE INDEX IF NOT EXISTS ix_audit_ref     ON busy_audit_log (external_reference);
CREATE INDEX IF NOT EXISTS ix_audit_created ON busy_audit_log (created_at);

-- --- RECONCILIATION --------------------------------------------------------
CREATE TABLE IF NOT EXISTS busy_reconciliation (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              TEXT    NOT NULL,
  entity_type         TEXT    NOT NULL,
  mes_entity_id       TEXT,
  external_reference  TEXT,
  busy_reference      TEXT,
  result              TEXT    NOT NULL CHECK (result IN
                        ('MATCH','MISMATCH','MISSING_IN_BUSY','MISSING_IN_MES','DUPLICATE')),
  differences         TEXT,                          -- JSON array of field diffs
  resolved            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_recon_run    ON busy_reconciliation (run_id);
CREATE INDEX IF NOT EXISTS ix_recon_result ON busy_reconciliation (result, resolved);

-- --- CONNECTION HEALTH -----------------------------------------------------
-- Single-row table tracking BUSY availability, so the dashboard can show
-- "last successful sync" and the worker can back off while BUSY is offline.
CREATE TABLE IF NOT EXISTS busy_connection_state (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  online                INTEGER NOT NULL DEFAULT 0,
  last_checked_at       TEXT,
  last_success_at       TEXT,
  last_error_code       TEXT,
  last_error_message    TEXT,
  adapter               TEXT
);

INSERT OR IGNORE INTO busy_connection_state (id, online) VALUES (1, 0);
`;
