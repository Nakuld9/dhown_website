import type { Db } from '../db';
import { isoToSqlite, now } from '../db';
import type { EntityType } from '../config';
import type { SyncOperation } from '../domain/types';

/**
 * The outbound queue.
 *
 * MES never talks to BUSY directly and never waits for it. It hands a record
 * to this queue and carries on — which is what keeps the factory running when
 * BUSY is offline.
 */

export type QueueStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AWAITING_BUSY'
  | 'SUCCESS'
  | 'FAILED'
  | 'RETRY'
  | 'MANUAL_REVIEW';

export interface QueueItem {
  id: number;
  entityType: EntityType;
  mesEntityId: string;
  operation: SyncOperation;
  payload: string;
  payloadVersion: number;
  externalReference: string;
  status: QueueStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  busyReference: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Classified error details as JSON, or null. See BridgeError.details. */
  errorDetails: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueInput {
  entityType: EntityType;
  mesEntityId: string;
  operation: SyncOperation;
  payload: unknown;
  externalReference: string;
  payloadVersion?: number;
  createdBy?: string;
}

export interface EnqueueResult {
  item: QueueItem;
  /** False when an item with this external reference already existed. */
  created: boolean;
}

function mapRow(row: Record<string, any>): QueueItem {
  return {
    id: row.id,
    entityType: row.entity_type,
    mesEntityId: row.mes_entity_id,
    operation: row.operation,
    payload: row.payload,
    payloadVersion: row.payload_version,
    externalReference: row.external_reference,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    nextRetryAt: row.next_retry_at,
    busyReference: row.busy_reference,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    errorDetails: row.error_details ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class QueueStore {
  constructor(private readonly db: Db) {}

  /**
   * Enqueue, idempotently.
   *
   * The UNIQUE index on external_reference is the real guarantee. We attempt
   * the insert and treat a uniqueness violation as "already queued" rather
   * than checking first — a check-then-insert has a race window that two
   * concurrent MES deliveries will eventually find.
   */
  enqueue(input: EnqueueInput): EnqueueResult {
    const payload = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload);
    const info = this.db
      .prepare(
        `INSERT INTO busy_sync_queue
           (entity_type, mes_entity_id, operation, payload, payload_version, external_reference, status, created_by)
         VALUES (?,?,?,?,?,?, 'PENDING', ?)
         ON CONFLICT (external_reference) DO NOTHING`,
      )
      .run(
        input.entityType,
        input.mesEntityId,
        input.operation,
        payload,
        input.payloadVersion ?? 1,
        input.externalReference,
        input.createdBy ?? 'MES',
      );

    const item = this.findByExternalReference(input.externalReference)!;
    return { item, created: info.changes > 0 };
  }

  findById(id: number): QueueItem | null {
    const row = this.db.prepare('SELECT * FROM busy_sync_queue WHERE id = ?').get(id) as Record<string, any> | undefined;
    return row ? mapRow(row) : null;
  }

  findByExternalReference(externalReference: string): QueueItem | null {
    const row = this.db
      .prepare('SELECT * FROM busy_sync_queue WHERE external_reference = ?')
      .get(externalReference) as Record<string, any> | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Atomically claim up to `limit` jobs that are due.
   *
   * The UPDATE ... WHERE id IN (SELECT ...) runs inside a transaction and
   * flips the rows to PROCESSING as part of the claim, so two workers cannot
   * pick up the same job and send it to BUSY twice.
   */
  claimBatch(limit: number, at: Date = new Date()): QueueItem[] {
    const stamp = isoToSqlite(at);
    const claim = this.db.transaction((n: number): QueueItem[] => {
      const rows = this.db
        .prepare(
          `SELECT id FROM busy_sync_queue
            WHERE (status = 'PENDING')
               OR (status = 'RETRY' AND (next_retry_at IS NULL OR next_retry_at <= ?))
            ORDER BY id ASC
            LIMIT ?`,
        )
        .all(stamp, n) as Array<{ id: number }>;
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      this.db
        .prepare(
          `UPDATE busy_sync_queue
              SET status = 'PROCESSING', updated_at = ?
            WHERE id IN (${placeholders})`,
        )
        .run(now(), ...ids);

      return (
        this.db.prepare(`SELECT * FROM busy_sync_queue WHERE id IN (${placeholders}) ORDER BY id ASC`).all(...ids) as Array<
          Record<string, any>
        >
      ).map(mapRow);
    });
    return claim(limit);
  }

  /** Jobs handed to BUSY asynchronously whose acknowledgement we still await. */
  awaitingBusy(limit = 100): QueueItem[] {
    return (
      this.db
        .prepare(`SELECT * FROM busy_sync_queue WHERE status = 'AWAITING_BUSY' ORDER BY id ASC LIMIT ?`)
        .all(limit) as Array<Record<string, any>>
    ).map(mapRow);
  }

  recordAttempt(id: number): void {
    this.db
      .prepare('UPDATE busy_sync_queue SET attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), id);
  }

  markSuccess(id: number, busyReference?: string | null): void {
    this.db
      .prepare(
        `UPDATE busy_sync_queue
            SET status = 'SUCCESS', busy_reference = COALESCE(?, busy_reference),
                error_code = NULL, error_message = NULL, error_details = NULL,
                next_retry_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(busyReference ?? null, now(), id);
  }

  markAwaitingBusy(id: number, message?: string): void {
    this.db
      .prepare(
        `UPDATE busy_sync_queue
            SET status = 'AWAITING_BUSY', error_code = NULL, error_message = ?, error_details = NULL,
                next_retry_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(message ?? null, now(), id);
  }

  markRetry(id: number, nextRetryAt: Date, errorCode: string, errorMessage: string, errorDetails?: string): void {
    this.db
      .prepare(
        `UPDATE busy_sync_queue
            SET status = 'RETRY', next_retry_at = ?, error_code = ?, error_message = ?, error_details = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(isoToSqlite(nextRetryAt), errorCode, errorMessage, errorDetails ?? null, now(), id);
  }

  markFailed(id: number, errorCode: string, errorMessage: string, errorDetails?: string): void {
    this.db
      .prepare(
        `UPDATE busy_sync_queue
            SET status = 'FAILED', error_code = ?, error_message = ?, error_details = ?,
                next_retry_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(errorCode, errorMessage, errorDetails ?? null, now(), id);
  }

  markManualReview(id: number, errorCode: string, errorMessage: string, errorDetails?: string): void {
    this.db
      .prepare(
        `UPDATE busy_sync_queue
            SET status = 'MANUAL_REVIEW', error_code = ?, error_message = ?, error_details = ?,
                next_retry_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(errorCode, errorMessage, errorDetails ?? null, now(), id);
  }

  /**
   * Operator-forced retry from the dashboard.
   *
   * Attempt count is deliberately NOT reset: the audit trail must keep showing
   * how many times this record has been tried in total. The job simply becomes
   * due again immediately.
   */
  requeueForManualRetry(id: number): QueueItem | null {
    const item = this.findById(id);
    if (!item) return null;
    if (item.status === 'SUCCESS') return item; // never resend something BUSY booked
    this.db
      .prepare(
        `UPDATE busy_sync_queue
            SET status = 'PENDING', next_retry_at = NULL, error_code = NULL, error_message = NULL,
                error_details = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(now(), id);
    return this.findById(id);
  }

  /**
   * Release jobs stuck in PROCESSING because the worker died mid-flight.
   * They go back to PENDING; idempotency (external reference + BUSY-side
   * status check) is what stops the retry creating a duplicate.
   */
  releaseStaleProcessing(olderThan: Date): number {
    const info = this.db
      .prepare(
        `UPDATE busy_sync_queue
            SET status = 'PENDING', updated_at = ?
          WHERE status = 'PROCESSING' AND updated_at < ?`,
      )
      .run(now(), isoToSqlite(olderThan));
    return info.changes;
  }

  counts(): Record<QueueStatus, number> {
    const base: Record<QueueStatus, number> = {
      PENDING: 0,
      PROCESSING: 0,
      AWAITING_BUSY: 0,
      SUCCESS: 0,
      FAILED: 0,
      RETRY: 0,
      MANUAL_REVIEW: 0,
    };
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM busy_sync_queue GROUP BY status').all() as Array<{
      status: QueueStatus;
      n: number;
    }>;
    for (const r of rows) base[r.status] = r.n;
    return base;
  }

  countToday(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM busy_sync_queue WHERE date(created_at) = date('now')`)
      .get() as { n: number };
    return row.n;
  }

  lastSuccessAt(): string | null {
    const row = this.db
      .prepare(`SELECT MAX(updated_at) AS t FROM busy_sync_queue WHERE status = 'SUCCESS'`)
      .get() as { t: string | null };
    return row.t;
  }

  list(filter: { status?: QueueStatus; entityType?: EntityType; search?: string; limit?: number; offset?: number } = {}): QueueItem[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.entityType) {
      where.push('entity_type = ?');
      params.push(filter.entityType);
    }
    if (filter.search) {
      where.push('(external_reference LIKE ? OR mes_entity_id LIKE ? OR busy_reference LIKE ?)');
      const like = `%${filter.search}%`;
      params.push(like, like, like);
    }
    const sql =
      `SELECT * FROM busy_sync_queue${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
      ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(filter.limit ?? 50, filter.offset ?? 0);
    return (this.db.prepare(sql).all(...params) as Array<Record<string, any>>).map(mapRow);
  }

  /** Recent successful transactions, for the reconciler's lookback window. */
  recentCompleted(sinceDays: number, limit = 500): QueueItem[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM busy_sync_queue
            WHERE status IN ('SUCCESS','AWAITING_BUSY')
              AND created_at >= datetime('now', ?)
            ORDER BY id DESC LIMIT ?`,
        )
        .all(`-${sinceDays} days`, limit) as Array<Record<string, any>>
    ).map(mapRow);
  }
}
