import type { Db } from '../db';
import { now } from '../db';
import { MappingError } from '../errors';

/**
 * Master mapping: MES id <-> BUSY id.
 *
 * The spec's rule "never assume IDs are identical" is enforced structurally —
 * there is no code path that sends a MES id to BUSY as if it were a BUSY id.
 * Resolution always goes through this table and fails loudly when a mapping is
 * missing, because guessing would post a voucher against the wrong ledger.
 */

export type MappingEntityType = 'CUSTOMER' | 'VENDOR' | 'ITEM' | 'WAREHOUSE' | 'TRANSACTION';
export type MappingSyncStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'MANUAL_REVIEW';

export interface MasterMapping {
  id: number;
  entityType: MappingEntityType;
  mesId: string;
  busyId: string | null;
  busyCode: string | null;
  syncStatus: MappingSyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  mesName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: number;
  entity_type: MappingEntityType;
  mes_id: string;
  busy_id: string | null;
  busy_code: string | null;
  sync_status: MappingSyncStatus;
  last_synced_at: string | null;
  error: string | null;
  mes_name: string | null;
  created_at: string;
  updated_at: string;
}

function toMapping(row: Row): MasterMapping {
  return {
    id: row.id,
    entityType: row.entity_type,
    mesId: row.mes_id,
    busyId: row.busy_id,
    busyCode: row.busy_code,
    syncStatus: row.sync_status,
    lastSyncedAt: row.last_synced_at,
    error: row.error,
    mesName: row.mes_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MappingStore {
  constructor(private readonly db: Db) {}

  find(entityType: MappingEntityType, mesId: string): MasterMapping | null {
    const row = this.db
      .prepare<[string, string], Row>('SELECT * FROM busy_master_mapping WHERE entity_type = ? AND mes_id = ?')
      .get(entityType, mesId);
    return row ? toMapping(row) : null;
  }

  findByBusyId(entityType: MappingEntityType, busyId: string): MasterMapping | null {
    const row = this.db
      .prepare<[string, string], Row>('SELECT * FROM busy_master_mapping WHERE entity_type = ? AND busy_id = ?')
      .get(entityType, busyId);
    return row ? toMapping(row) : null;
  }

  /**
   * Resolve a MES id to a BUSY id, or fail with a MASTER_MAPPING_ERROR that
   * tells the operator exactly which record to map.
   */
  resolve(entityType: MappingEntityType, mesId: string): { busyId: string; busyCode?: string } {
    const mapping = this.find(entityType, mesId);
    if (!mapping || !mapping.busyId) {
      throw new MappingError(entityType, mesId);
    }
    return { busyId: mapping.busyId, ...(mapping.busyCode ? { busyCode: mapping.busyCode } : {}) };
  }

  /** Register a MES record as awaiting a BUSY counterpart. */
  upsertPending(entityType: MappingEntityType, mesId: string, mesName?: string): MasterMapping {
    this.db
      .prepare(
        `INSERT INTO busy_master_mapping (entity_type, mes_id, mes_name, sync_status)
         VALUES (?, ?, ?, 'PENDING')
         ON CONFLICT (entity_type, mes_id) DO UPDATE SET
           mes_name   = COALESCE(excluded.mes_name, busy_master_mapping.mes_name),
           updated_at = ?`,
      )
      .run(entityType, mesId, mesName ?? null, now());
    return this.find(entityType, mesId)!;
  }

  /** Record a successful sync and the BUSY identity it produced. */
  markSynced(entityType: MappingEntityType, mesId: string, busyId: string, busyCode?: string): MasterMapping {
    this.db
      .prepare(
        `INSERT INTO busy_master_mapping
           (entity_type, mes_id, busy_id, busy_code, sync_status, last_synced_at, error, updated_at)
         VALUES (?, ?, ?, ?, 'SYNCED', ?, NULL, ?)
         ON CONFLICT (entity_type, mes_id) DO UPDATE SET
           busy_id        = excluded.busy_id,
           busy_code      = excluded.busy_code,
           sync_status    = 'SYNCED',
           last_synced_at = excluded.last_synced_at,
           error          = NULL,
           updated_at     = excluded.updated_at`,
      )
      .run(entityType, mesId, busyId, busyCode ?? null, now(), now());
    return this.find(entityType, mesId)!;
  }

  markFailed(entityType: MappingEntityType, mesId: string, error: string, status: MappingSyncStatus = 'FAILED'): void {
    this.db
      .prepare(
        `INSERT INTO busy_master_mapping (entity_type, mes_id, sync_status, error, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (entity_type, mes_id) DO UPDATE SET
           sync_status = excluded.sync_status,
           error       = excluded.error,
           updated_at  = excluded.updated_at`,
      )
      .run(entityType, mesId, status, error, now());
  }

  /**
   * Manual mapping from the dashboard's "Fix Mapping" action: an operator
   * states that MES record X is BUSY record Y.
   */
  setManualMapping(
    entityType: MappingEntityType,
    mesId: string,
    busyId: string,
    busyCode?: string,
  ): MasterMapping {
    const clash = this.findByBusyId(entityType, busyId);
    if (clash && clash.mesId !== mesId) {
      // Two MES records pointing at one BUSY ledger silently merges two
      // customers' accounts. Refuse rather than let the UNIQUE index surface
      // as an opaque SQLite error.
      throw new Error(
        `BUSY ${entityType} "${busyId}" is already mapped to MES record "${clash.mesId}". ` +
          `Unmap it first if this is a correction.`,
      );
    }
    return this.markSynced(entityType, mesId, busyId, busyCode);
  }

  clearMapping(entityType: MappingEntityType, mesId: string): void {
    this.db
      .prepare(
        `UPDATE busy_master_mapping
            SET busy_id = NULL, busy_code = NULL, sync_status = 'PENDING', error = NULL, updated_at = ?
          WHERE entity_type = ? AND mes_id = ?`,
      )
      .run(now(), entityType, mesId);
  }

  list(filter: { entityType?: MappingEntityType; syncStatus?: MappingSyncStatus; search?: string; limit?: number } = {}): MasterMapping[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.entityType) {
      where.push('entity_type = ?');
      params.push(filter.entityType);
    }
    if (filter.syncStatus) {
      where.push('sync_status = ?');
      params.push(filter.syncStatus);
    }
    if (filter.search) {
      where.push('(mes_id LIKE ? OR busy_id LIKE ? OR busy_code LIKE ? OR mes_name LIKE ?)');
      const like = `%${filter.search}%`;
      params.push(like, like, like, like);
    }
    const sql =
      `SELECT * FROM busy_master_mapping${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
      ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(filter.limit ?? 200);
    return (this.db.prepare(sql).all(...params) as Row[]).map(toMapping);
  }

  /** Counts per status, for the dashboard's mapping health panel. */
  counts(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT sync_status, COUNT(*) AS n FROM busy_master_mapping GROUP BY sync_status')
      .all() as Array<{ sync_status: string; n: number }>;
    const out: Record<string, number> = { PENDING: 0, SYNCED: 0, FAILED: 0, MANUAL_REVIEW: 0 };
    for (const r of rows) out[r.sync_status] = r.n;
    return out;
  }

  /** Every MES id that still has no BUSY counterpart — the operator's to-do list. */
  unmapped(entityType?: MappingEntityType): MasterMapping[] {
    const sql = entityType
      ? 'SELECT * FROM busy_master_mapping WHERE busy_id IS NULL AND entity_type = ? ORDER BY updated_at DESC LIMIT 500'
      : 'SELECT * FROM busy_master_mapping WHERE busy_id IS NULL ORDER BY updated_at DESC LIMIT 500';
    const rows = (entityType ? this.db.prepare(sql).all(entityType) : this.db.prepare(sql).all()) as Row[];
    return rows.map(toMapping);
  }
}
