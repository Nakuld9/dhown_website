import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import type { BusyAdapter } from '../adapters/BusyAdapter';
import type { MappingStore } from '../mapping/mappingStore';
import type { QueueItem, QueueStore } from '../queue/queueStore';
import { classifyError } from '../errors';
import { log } from '../logger';
import type { MesDocumentLine } from '../domain/types';

/**
 * Reconciliation.
 *
 * "It said SUCCESS" is not the same as "the two systems agree". This compares
 * what MES sent with what BUSY actually holds, field by field, and classifies
 * every transaction so divergence is visible instead of discovered at audit
 * time.
 */

export type ReconResult = 'MATCH' | 'MISMATCH' | 'MISSING_IN_BUSY' | 'MISSING_IN_MES' | 'DUPLICATE';

export interface FieldDifference {
  field: string;
  mes: unknown;
  busy: unknown;
}

export interface ReconciliationRow {
  id: number;
  runId: string;
  entityType: string;
  mesEntityId: string | null;
  externalReference: string | null;
  busyReference: string | null;
  result: ReconResult;
  differences: FieldDifference[];
  resolved: boolean;
  createdAt: string;
}

export interface ReconciliationSummary {
  runId: string;
  checked: number;
  MATCH: number;
  MISMATCH: number;
  MISSING_IN_BUSY: number;
  MISSING_IN_MES: number;
  DUPLICATE: number;
}

/** Quantities and money are floats; compare with a tolerance, not equality. */
const QUANTITY_TOLERANCE = 0.001;
const AMOUNT_TOLERANCE = 1; // rupee rounding differs between MES and BUSY

function closeEnough(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

export class Reconciler {
  constructor(
    private readonly db: Db,
    private readonly adapter: BusyAdapter,
    private readonly queue: QueueStore,
    private readonly mappings: MappingStore,
  ) {}

  /**
   * Reconcile everything synced in the lookback window.
   *
   * Only SUCCESS/AWAITING_BUSY items are candidates — a FAILED item is already
   * visible on the dashboard and does not need a second alarm.
   */
  async run(lookbackDays: number, limit = 500): Promise<ReconciliationSummary> {
    const runId = randomUUID();
    const summary: ReconciliationSummary = {
      runId,
      checked: 0,
      MATCH: 0,
      MISMATCH: 0,
      MISSING_IN_BUSY: 0,
      MISSING_IN_MES: 0,
      DUPLICATE: 0,
    };

    if (!this.adapter.capabilities().reconcileTransaction) {
      log.warn('Adapter cannot reconcile; skipping run', { adapter: this.adapter.name });
      return summary;
    }

    const items = this.queue.recentCompleted(lookbackDays, limit);
    const seenBusyReferences = new Map<string, string>();

    for (const item of items) {
      try {
        const row = await this.reconcileItem(runId, item, seenBusyReferences);
        summary.checked += 1;
        summary[row.result] += 1;
      } catch (err) {
        const be = classifyError(err);
        log.warn('Reconciliation of an item failed', {
          externalReference: item.externalReference,
          code: be.code,
          message: be.message,
        });
      }
    }

    log.info('Reconciliation run complete', { ...summary });
    return summary;
  }

  /** Reconcile one queue item against BUSY. */
  async reconcileItem(
    runId: string,
    item: QueueItem,
    seenBusyReferences: Map<string, string> = new Map(),
  ): Promise<ReconciliationRow> {
    const snapshot = await this.adapter.reconcileTransaction(item.externalReference);

    if (!snapshot) {
      // MES believes it synced; BUSY has no such transaction. This is the
      // dangerous case — a dispatch that left the factory with no accounting
      // entry behind it.
      return this.persist(runId, item, null, 'MISSING_IN_BUSY', [
        { field: 'transaction', mes: item.externalReference, busy: null },
      ]);
    }

    // Duplicate detection: one BUSY reference claimed by two MES records means
    // the same voucher was posted twice.
    if (snapshot.busyReference) {
      const previous = seenBusyReferences.get(snapshot.busyReference);
      if (previous && previous !== item.externalReference) {
        return this.persist(runId, item, snapshot.busyReference, 'DUPLICATE', [
          { field: 'busyReference', mes: item.externalReference, busy: previous },
        ]);
      }
      seenBusyReferences.set(snapshot.busyReference, item.externalReference);
    }

    const differences = this.compare(item, snapshot);
    return this.persist(
      runId,
      item,
      snapshot.busyReference ?? null,
      differences.length === 0 ? 'MATCH' : 'MISMATCH',
      differences,
    );
  }

  /** Field-by-field comparison: reference, party, item, quantity, amount. */
  private compare(item: QueueItem, snapshot: { [k: string]: any }): FieldDifference[] {
    const differences: FieldDifference[] = [];
    const payload = JSON.parse(item.payload) as Record<string, any>;

    // --- transaction reference ---
    if (item.busyReference && snapshot.busyReference && item.busyReference !== snapshot.busyReference) {
      differences.push({ field: 'busyReference', mes: item.busyReference, busy: snapshot.busyReference });
    }
    if (payload.documentNumber && snapshot.documentNumber && payload.documentNumber !== snapshot.documentNumber) {
      differences.push({ field: 'documentNumber', mes: payload.documentNumber, busy: snapshot.documentNumber });
    }

    // --- customer / vendor ---
    const partyMesId: string | undefined = payload.customerMesId ?? payload.vendorMesId;
    if (partyMesId && snapshot.partyBusyId) {
      const entityType = payload.customerMesId ? 'CUSTOMER' : 'VENDOR';
      const mapping = this.mappings.find(entityType, partyMesId);
      if (!mapping?.busyId) {
        differences.push({ field: 'party', mes: partyMesId, busy: snapshot.partyBusyId });
      } else if (mapping.busyId !== snapshot.partyBusyId) {
        // The voucher is booked against a different ledger than MES intended.
        differences.push({ field: 'party', mes: mapping.busyId, busy: snapshot.partyBusyId });
      }
    }

    // --- quantities, per item and in total ---
    const mesLines = (payload.lines as MesDocumentLine[] | undefined) ?? [];
    if (mesLines.length > 0) {
      const mesTotal = mesLines.reduce((s, l) => s + (l.quantity ?? 0), 0);
      if (typeof snapshot.totalQuantity === 'number' && !closeEnough(mesTotal, snapshot.totalQuantity, QUANTITY_TOLERANCE)) {
        differences.push({ field: 'totalQuantity', mes: mesTotal, busy: snapshot.totalQuantity });
      }

      if (Array.isArray(snapshot.lines)) {
        const busyByItem = new Map<string, number>();
        for (const line of snapshot.lines as Array<{ busyItemId: string; quantity: number }>) {
          busyByItem.set(line.busyItemId, (busyByItem.get(line.busyItemId) ?? 0) + line.quantity);
        }
        for (const line of mesLines) {
          const mapping = this.mappings.find('ITEM', line.itemMesId);
          if (!mapping?.busyId) {
            differences.push({ field: `item:${line.itemMesId}`, mes: line.itemMesId, busy: null });
            continue;
          }
          const busyQty = busyByItem.get(mapping.busyId);
          if (busyQty === undefined) {
            differences.push({ field: `item:${line.itemMesId}`, mes: line.quantity, busy: null });
          } else if (!closeEnough(busyQty, line.quantity, QUANTITY_TOLERANCE)) {
            differences.push({ field: `quantity:${line.itemMesId}`, mes: line.quantity, busy: busyQty });
          }
          busyByItem.delete(mapping.busyId);
        }
        // Anything left is in BUSY but not in the MES document.
        for (const [busyItemId, quantity] of busyByItem) {
          differences.push({ field: `item:${busyItemId}`, mes: null, busy: quantity });
        }
      }
    }

    // --- amounts ---
    const mesAmount: number | undefined =
      payload.totalAmount ??
      (mesLines.length > 0
        ? mesLines.reduce((s, l) => s + (l.amount ?? (l.rate ?? 0) * (l.quantity ?? 0)), 0)
        : undefined);
    if (typeof mesAmount === 'number' && typeof snapshot.totalAmount === 'number' && mesAmount > 0) {
      if (!closeEnough(mesAmount, snapshot.totalAmount, AMOUNT_TOLERANCE)) {
        differences.push({ field: 'totalAmount', mes: +mesAmount.toFixed(2), busy: snapshot.totalAmount });
      }
    }

    return differences;
  }

  private persist(
    runId: string,
    item: QueueItem,
    busyReference: string | null,
    result: ReconResult,
    differences: FieldDifference[],
  ): ReconciliationRow {
    const info = this.db
      .prepare(
        `INSERT INTO busy_reconciliation
           (run_id, entity_type, mes_entity_id, external_reference, busy_reference, result, differences)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        runId,
        item.entityType,
        item.mesEntityId,
        item.externalReference,
        busyReference,
        result,
        JSON.stringify(differences),
      );

    if (result !== 'MATCH') {
      log.warn('Reconciliation divergence', {
        externalReference: item.externalReference,
        result,
        differences,
      });
    }

    return {
      id: Number(info.lastInsertRowid),
      runId,
      entityType: item.entityType,
      mesEntityId: item.mesEntityId,
      externalReference: item.externalReference,
      busyReference,
      result,
      differences,
      resolved: false,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * BUSY-side records with no MES counterpart.
   *
   * Runs the comparison in the other direction: masters BUSY knows about that
   * the bridge has never mapped. These are MISSING_IN_MES.
   */
  async findMissingInMes(entityType: 'CUSTOMER' | 'VENDOR' | 'ITEM'): Promise<ReconciliationRow[]> {
    const caps = this.adapter.capabilities();
    const capable =
      entityType === 'CUSTOMER' ? caps.getCustomers : entityType === 'VENDOR' ? caps.getVendors : caps.getItems;
    if (!capable) return [];

    const records =
      entityType === 'CUSTOMER'
        ? await this.adapter.getCustomers()
        : entityType === 'VENDOR'
          ? await this.adapter.getVendors()
          : await this.adapter.getItems();

    const runId = randomUUID();
    const rows: ReconciliationRow[] = [];
    for (const record of records) {
      if (this.mappings.findByBusyId(entityType, record.busyId)) continue;
      const info = this.db
        .prepare(
          `INSERT INTO busy_reconciliation
             (run_id, entity_type, mes_entity_id, external_reference, busy_reference, result, differences)
           VALUES (?,?,NULL,NULL,?,'MISSING_IN_MES',?)`,
        )
        .run(runId, entityType, record.busyId, JSON.stringify([{ field: 'name', mes: null, busy: record.name }]));
      rows.push({
        id: Number(info.lastInsertRowid),
        runId,
        entityType,
        mesEntityId: null,
        externalReference: null,
        busyReference: record.busyId,
        result: 'MISSING_IN_MES',
        differences: [{ field: 'name', mes: null, busy: record.name }],
        resolved: false,
        createdAt: new Date().toISOString(),
      });
    }
    return rows;
  }

  list(filter: { result?: ReconResult; resolved?: boolean; runId?: string; limit?: number } = {}): ReconciliationRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.result) {
      where.push('result = ?');
      params.push(filter.result);
    }
    if (filter.resolved !== undefined) {
      where.push('resolved = ?');
      params.push(filter.resolved ? 1 : 0);
    }
    if (filter.runId) {
      where.push('run_id = ?');
      params.push(filter.runId);
    }
    const sql =
      `SELECT * FROM busy_reconciliation${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
      ' ORDER BY id DESC LIMIT ?';
    params.push(filter.limit ?? 200);
    return (this.db.prepare(sql).all(...params) as Array<Record<string, any>>).map((row) => ({
      id: row.id,
      runId: row.run_id,
      entityType: row.entity_type,
      mesEntityId: row.mes_entity_id,
      externalReference: row.external_reference,
      busyReference: row.busy_reference,
      result: row.result,
      differences: JSON.parse(row.differences ?? '[]'),
      resolved: row.resolved === 1,
      createdAt: row.created_at,
    }));
  }

  markResolved(id: number): void {
    this.db.prepare('UPDATE busy_reconciliation SET resolved = 1 WHERE id = ?').run(id);
  }

  summary(): Record<ReconResult, number> {
    const base: Record<ReconResult, number> = {
      MATCH: 0,
      MISMATCH: 0,
      MISSING_IN_BUSY: 0,
      MISSING_IN_MES: 0,
      DUPLICATE: 0,
    };
    const rows = this.db
      .prepare('SELECT result, COUNT(*) AS n FROM busy_reconciliation WHERE resolved = 0 GROUP BY result')
      .all() as Array<{ result: ReconResult; n: number }>;
    for (const r of rows) base[r.result] = r.n;
    return base;
  }
}
