import type { Db } from '../db';

/**
 * Append-only audit trail.
 *
 * The spec's rule is absolute: never silently discard an integration failure.
 * Every attempt — success, failure, duplicate, manual action — lands here with
 * the payload we sent and the response BUSY gave, so a disputed dispatch can
 * always be reconstructed months later.
 */

export interface AuditEntry {
  queueId?: number | null;
  entityType: string;
  mesEntityId: string;
  externalReference?: string | null;
  operation: string;
  payloadVersion?: number;
  payloadSnapshot?: string | null;
  attemptCount?: number;
  /** 'system', or the role/key-id of the operator who forced the action. */
  actor?: string;
  busyResponse?: string | null;
  busyReference?: string | null;
  finalStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface AuditRow extends AuditEntry {
  id: number;
  createdAt: string;
}

/** BUSY responses can be large; keep the trail useful without unbounded growth. */
const MAX_RESPONSE_CHARS = 20000;

function truncate(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.length > MAX_RESPONSE_CHARS
    ? `${value.slice(0, MAX_RESPONSE_CHARS)}\n...[truncated ${value.length - MAX_RESPONSE_CHARS} chars]`
    : value;
}

export class AuditLog {
  constructor(private readonly db: Db) {}

  record(entry: AuditEntry): number {
    const info = this.db
      .prepare(
        `INSERT INTO busy_audit_log
           (queue_id, entity_type, mes_entity_id, external_reference, operation, payload_version,
            payload_snapshot, attempt_count, actor, busy_response, busy_reference,
            final_status, error_code, error_message)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        entry.queueId ?? null,
        entry.entityType,
        entry.mesEntityId,
        entry.externalReference ?? null,
        entry.operation,
        entry.payloadVersion ?? 1,
        truncate(entry.payloadSnapshot),
        entry.attemptCount ?? 0,
        entry.actor ?? 'system',
        truncate(entry.busyResponse),
        entry.busyReference ?? null,
        entry.finalStatus,
        entry.errorCode ?? null,
        entry.errorMessage ?? null,
      );
    return Number(info.lastInsertRowid);
  }

  forQueueItem(queueId: number): AuditRow[] {
    const rows = this.db
      .prepare('SELECT * FROM busy_audit_log WHERE queue_id = ? ORDER BY id ASC')
      .all(queueId) as Array<Record<string, any>>;
    return rows.map(mapRow);
  }

  forExternalReference(externalReference: string): AuditRow[] {
    const rows = this.db
      .prepare('SELECT * FROM busy_audit_log WHERE external_reference = ? ORDER BY id ASC')
      .all(externalReference) as Array<Record<string, any>>;
    return rows.map(mapRow);
  }

  recent(limit = 100): AuditRow[] {
    const rows = this.db
      .prepare('SELECT * FROM busy_audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<Record<string, any>>;
    return rows.map(mapRow);
  }
}

function mapRow(row: Record<string, any>): AuditRow {
  return {
    id: row.id,
    queueId: row.queue_id,
    entityType: row.entity_type,
    mesEntityId: row.mes_entity_id,
    externalReference: row.external_reference,
    operation: row.operation,
    payloadVersion: row.payload_version,
    payloadSnapshot: row.payload_snapshot,
    attemptCount: row.attempt_count,
    actor: row.actor,
    busyResponse: row.busy_response,
    busyReference: row.busy_reference,
    finalStatus: row.final_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}
