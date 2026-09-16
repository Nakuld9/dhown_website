import type { EntityType } from '../config';
import type { BusyAdapter, SendContext } from '../adapters/BusyAdapter';
import type { AuditLog } from '../audit/auditLog';
import type { MappingStore, MappingEntityType } from '../mapping/mappingStore';
import type { QueueItem, QueueStore } from './queueStore';
import type { RetryPolicy } from './retryPolicy';
import { BridgeError, UnsupportedOperationError, classifyError } from '../errors';
import { log } from '../logger';
import type {
  BusyResult,
  MesCustomer,
  MesDispatch,
  MesDocumentLine,
  MesInvoice,
  MesItem,
  MesPurchaseReference,
  MesSalesReference,
  MesVendor,
} from '../domain/types';

/** Which adapter capability each entity type needs. */
const CAPABILITY_FOR: Record<EntityType, keyof ReturnType<BusyAdapter['capabilities']>> = {
  CUSTOMER: 'createOrUpdateCustomer',
  VENDOR: 'createOrUpdateVendor',
  ITEM: 'createOrUpdateItem',
  WAREHOUSE: 'createOrUpdateItem', // warehouses ride the master path
  SALES_REFERENCE: 'sendSalesReference',
  PURCHASE_REFERENCE: 'sendPurchaseReference',
  DISPATCH: 'sendDispatch',
  INVOICE: 'sendInvoice',
};

const MASTER_TYPES: ReadonlySet<EntityType> = new Set<EntityType>(['CUSTOMER', 'VENDOR', 'ITEM', 'WAREHOUSE']);

export interface ProcessOutcome {
  queueId: number;
  externalReference: string;
  status: QueueItem['status'];
  busyReference?: string | null;
  errorCode?: string;
  /** True when the item was resolved without sending anything new to BUSY. */
  deduplicated?: boolean;
}

export interface SyncServiceDeps {
  adapter: BusyAdapter;
  queue: QueueStore;
  mappings: MappingStore;
  audit: AuditLog;
  retryPolicy: RetryPolicy;
}

/**
 * Processes one queue item: resolve mappings, guard idempotency, call BUSY,
 * classify the outcome, and write the audit trail.
 *
 * This class contains no production logic of any kind — no scheduling, no
 * capacity, no machine state. It translates, validates, sends and records.
 */
export class SyncService {
  private readonly adapter: BusyAdapter;
  private readonly queue: QueueStore;
  private readonly mappings: MappingStore;
  private readonly audit: AuditLog;
  private readonly retryPolicy: RetryPolicy;

  constructor(deps: SyncServiceDeps) {
    this.adapter = deps.adapter;
    this.queue = deps.queue;
    this.mappings = deps.mappings;
    this.audit = deps.audit;
    this.retryPolicy = deps.retryPolicy;
  }

  async process(item: QueueItem, actor = 'system'): Promise<ProcessOutcome> {
    this.queue.recordAttempt(item.id);
    const attempt = item.attemptCount + 1;

    try {
      const capability = CAPABILITY_FOR[item.entityType];
      if (!this.adapter.capabilities()[capability]) {
        throw new UnsupportedOperationError(capability, this.adapter.name);
      }

      const payload = JSON.parse(item.payload) as Record<string, unknown>;

      // --- IDEMPOTENCY GUARD ------------------------------------------------
      // Before creating anything, ask BUSY whether it already holds this
      // external reference. This is what makes a crash between "sent" and
      // "recorded" safe: we recover the existing reference instead of posting
      // a second voucher.
      const prior = await this.checkExisting(item);
      if (prior) return prior;

      const ctx = this.buildContext(item, payload, attempt);
      const result = await this.send(item, payload, ctx);

      return this.applyResult(item, ctx, result, attempt, actor);
    } catch (err) {
      return this.applyFailure(item, err, attempt, actor);
    }
  }

  /**
   * Ask BUSY whether this external reference already exists.
   *
   * A failure to ask is not a failure of the job — if BUSY is unreachable the
   * send below will fail and be retried anyway. But we must not treat
   * "couldn't check" as "doesn't exist".
   */
  private async checkExisting(item: QueueItem): Promise<ProcessOutcome | null> {
    if (!this.adapter.capabilities().getTransactionStatus) return null;

    let existing: BusyResult;
    try {
      existing = await this.adapter.getTransactionStatus(item.externalReference);
    } catch (err) {
      const be = classifyError(err);
      if (be.retryable) {
        // Cannot confirm; let the send path deal with the outage.
        log.debug('Idempotency pre-check unavailable', {
          externalReference: item.externalReference,
          code: be.code,
        });
        return null;
      }
      throw be;
    }

    if (existing.status === 'POSTED' || existing.status === 'DUPLICATE') {
      this.queue.markSuccess(item.id, existing.busyReference ?? null);
      this.recordMasterMappingFromResult(item, existing);
      this.audit.record({
        queueId: item.id,
        entityType: item.entityType,
        mesEntityId: item.mesEntityId,
        externalReference: item.externalReference,
        operation: item.operation,
        payloadVersion: item.payloadVersion,
        attemptCount: item.attemptCount + 1,
        actor: 'system',
        busyResponse: existing.raw ?? existing.message ?? null,
        busyReference: existing.busyReference ?? null,
        finalStatus: 'SUCCESS',
        errorCode: 'DUPLICATE_SUPPRESSED',
        errorMessage: 'External reference already present in BUSY; no duplicate was created.',
      });
      log.info('Duplicate suppressed', {
        externalReference: item.externalReference,
        busyReference: existing.busyReference,
      });
      return {
        queueId: item.id,
        externalReference: item.externalReference,
        status: 'SUCCESS',
        busyReference: existing.busyReference ?? null,
        deduplicated: true,
      };
    }

    if (existing.status === 'REJECTED') {
      throw new BridgeError('BUSY_TRANSACTION_ERROR', existing.message ?? 'BUSY previously rejected this transaction.', {
        busyResponse: existing.raw,
      });
    }

    // ACCEPTED means our own earlier hand-off is still in flight — do not send
    // it again, just wait for the acknowledgement.
    if (existing.status === 'ACCEPTED' && item.attemptCount > 0) {
      this.queue.markAwaitingBusy(item.id, existing.message ?? 'Awaiting BUSY acknowledgement.');
      return {
        queueId: item.id,
        externalReference: item.externalReference,
        status: 'AWAITING_BUSY',
        deduplicated: true,
      };
    }

    return null;
  }

  /** Resolve every MES id in the payload to its BUSY counterpart. */
  private buildContext(item: QueueItem, payload: Record<string, unknown>, attempt: number): SendContext {
    const ctx: SendContext = { externalReference: item.externalReference, itemBusyIds: {}, attempt };

    const customerMesId = payload.customerMesId as string | undefined;
    const vendorMesId = payload.vendorMesId as string | undefined;
    const warehouseMesId = payload.warehouseMesId as string | undefined;

    if (customerMesId) {
      const resolved = this.mappings.resolve('CUSTOMER', customerMesId);
      ctx.partyBusyId = resolved.busyId;
      if (resolved.busyCode) ctx.partyBusyCode = resolved.busyCode;
    } else if (vendorMesId) {
      const resolved = this.mappings.resolve('VENDOR', vendorMesId);
      ctx.partyBusyId = resolved.busyId;
      if (resolved.busyCode) ctx.partyBusyCode = resolved.busyCode;
    }

    if (warehouseMesId) {
      ctx.warehouseBusyId = this.mappings.resolve('WAREHOUSE', warehouseMesId).busyId;
    }

    const lines = payload.lines as MesDocumentLine[] | undefined;
    if (Array.isArray(lines)) {
      for (const line of lines) {
        // resolve() throws MASTER_MAPPING_ERROR naming the MES item, which is
        // what surfaces as "Map MES item FC-00125 to a BUSY item".
        const resolved = this.mappings.resolve('ITEM', line.itemMesId);
        ctx.itemBusyIds[line.itemMesId] = resolved;
      }
    }

    // A master being (re)sent may already have a BUSY identity; pass it so the
    // adapter can update rather than create.
    if (MASTER_TYPES.has(item.entityType)) {
      const existing = this.mappings.find(item.entityType as MappingEntityType, item.mesEntityId);
      if (existing?.busyId) {
        if (item.entityType === 'ITEM') {
          ctx.itemBusyIds[item.mesEntityId] = {
            busyId: existing.busyId,
            ...(existing.busyCode ? { busyCode: existing.busyCode } : {}),
          };
        } else {
          ctx.partyBusyId = existing.busyId;
          if (existing.busyCode) ctx.partyBusyCode = existing.busyCode;
        }
      }
    }

    return ctx;
  }

  private send(item: QueueItem, payload: Record<string, unknown>, ctx: SendContext): Promise<BusyResult> {
    switch (item.entityType) {
      case 'CUSTOMER':
        return this.adapter.createOrUpdateCustomer(payload as unknown as MesCustomer, ctx);
      case 'VENDOR':
        return this.adapter.createOrUpdateVendor(payload as unknown as MesVendor, ctx);
      case 'ITEM':
      case 'WAREHOUSE':
        return this.adapter.createOrUpdateItem(payload as unknown as MesItem, ctx);
      case 'SALES_REFERENCE':
        return this.adapter.sendSalesReference(payload as unknown as MesSalesReference, ctx);
      case 'PURCHASE_REFERENCE':
        return this.adapter.sendPurchaseReference(payload as unknown as MesPurchaseReference, ctx);
      case 'DISPATCH':
        return this.adapter.sendDispatch(payload as unknown as MesDispatch, ctx);
      case 'INVOICE':
        return this.adapter.sendInvoice(payload as unknown as MesInvoice, ctx);
      default: {
        const exhaustive: never = item.entityType;
        throw new BridgeError('VALIDATION_ERROR', `Unsupported entity type "${exhaustive}".`);
      }
    }
  }

  /** When BUSY returns an identity for a master record, store the mapping. */
  private recordMasterMappingFromResult(item: QueueItem, result: BusyResult): void {
    if (!MASTER_TYPES.has(item.entityType)) return;
    const busyId = result.busyReference ?? result.busyCode;
    if (!busyId) return;
    this.mappings.markSynced(
      item.entityType as MappingEntityType,
      item.mesEntityId,
      busyId,
      result.busyCode ?? undefined,
    );
  }

  private applyResult(
    item: QueueItem,
    ctx: SendContext,
    result: BusyResult,
    attempt: number,
    actor: string,
  ): ProcessOutcome {
    const auditBase = {
      queueId: item.id,
      entityType: item.entityType,
      mesEntityId: item.mesEntityId,
      externalReference: item.externalReference,
      operation: item.operation,
      payloadVersion: item.payloadVersion,
      payloadSnapshot: item.payload,
      attemptCount: attempt,
      actor,
      busyResponse: result.raw ?? result.message ?? null,
      busyReference: result.busyReference ?? null,
    };

    switch (result.status) {
      case 'POSTED': {
        this.queue.markSuccess(item.id, result.busyReference ?? null);
        this.recordMasterMappingFromResult(item, result);
        this.audit.record({ ...auditBase, finalStatus: 'SUCCESS' });
        log.info('Synced to BUSY', {
          externalReference: item.externalReference,
          busyReference: result.busyReference,
          entityType: item.entityType,
        });
        return {
          queueId: item.id,
          externalReference: item.externalReference,
          status: 'SUCCESS',
          busyReference: result.busyReference ?? null,
        };
      }

      case 'DUPLICATE': {
        // BUSY already had it. That is a success for the MES record; what we
        // must not do is send it again.
        this.queue.markSuccess(item.id, result.busyReference ?? null);
        this.recordMasterMappingFromResult(item, result);
        this.audit.record({
          ...auditBase,
          finalStatus: 'SUCCESS',
          errorCode: 'DUPLICATE_SUPPRESSED',
          errorMessage: result.message ?? 'BUSY already held this external reference.',
        });
        return {
          queueId: item.id,
          externalReference: item.externalReference,
          status: 'SUCCESS',
          busyReference: result.busyReference ?? null,
          deduplicated: true,
        };
      }

      case 'ACCEPTED': {
        // Handed over but not booked. Parking in AWAITING_BUSY keeps the
        // distinction honest — MES is not told a reference exists when it does
        // not yet.
        this.queue.markAwaitingBusy(item.id, result.message ?? 'Awaiting BUSY acknowledgement.');
        this.audit.record({ ...auditBase, finalStatus: 'AWAITING_BUSY' });
        log.info('Handed to BUSY, awaiting acknowledgement', { externalReference: item.externalReference });
        return { queueId: item.id, externalReference: item.externalReference, status: 'AWAITING_BUSY' };
      }

      case 'REJECTED':
      default: {
        const error = new BridgeError('BUSY_TRANSACTION_ERROR', result.message ?? 'BUSY rejected the transaction.', {
          busyResponse: result.raw,
        });
        return this.applyFailure(item, error, attempt, actor);
      }
    }
  }

  private applyFailure(item: QueueItem, err: unknown, attempt: number, actor: string): ProcessOutcome {
    const error = classifyError(err);
    const retry = this.retryPolicy.shouldRetry(attempt, error.retryable);

    // Keep the classified details with the row. The dashboard rebuilds the
    // operator's remediation message from these, and the subject it names (the
    // unmapped item, say) is not the queue row's own MES id.
    const details = JSON.stringify(error.details);

    let status: QueueItem['status'];
    if (retry) {
      const nextRetryAt = this.retryPolicy.nextRetryAt(attempt);
      this.queue.markRetry(item.id, nextRetryAt, error.code, error.message, details);
      status = 'RETRY';
    } else if (error.retryable) {
      // Retryable in nature, but we have exhausted the attempt budget. Park it
      // for a human rather than looping forever.
      this.queue.markManualReview(item.id, error.code, error.message, details);
      status = 'MANUAL_REVIEW';
    } else {
      // Cannot be fixed by retrying: mapping gaps, bad data, BUSY rejections.
      // MANUAL_REVIEW rather than FAILED, because every one of these needs a
      // person, and FAILED items would otherwise sit unnoticed.
      this.queue.markManualReview(item.id, error.code, error.message, details);
      status = 'MANUAL_REVIEW';
    }

    if (error.code === 'MASTER_MAPPING_ERROR' && typeof error.details.subject === 'string') {
      const entityType = (error.details.entityType as MappingEntityType) ?? 'ITEM';
      this.mappings.markFailed(entityType, error.details.subject, error.message, 'MANUAL_REVIEW');
    }

    this.audit.record({
      queueId: item.id,
      entityType: item.entityType,
      mesEntityId: item.mesEntityId,
      externalReference: item.externalReference,
      operation: item.operation,
      payloadVersion: item.payloadVersion,
      payloadSnapshot: item.payload,
      attemptCount: attempt,
      actor,
      busyResponse: (error.details.busyResponse as string | undefined) ?? null,
      finalStatus: status,
      errorCode: error.code,
      errorMessage: error.message,
    });

    log.warn('BUSY sync attempt failed', {
      externalReference: item.externalReference,
      code: error.code,
      attempt,
      status,
      message: error.message,
    });

    return { queueId: item.id, externalReference: item.externalReference, status, errorCode: error.code };
  }

  /**
   * Poll BUSY for jobs we handed over asynchronously.
   *
   * This is how the XML file-drop flow eventually learns its BUSY reference
   * and completes the loop back into MES.
   */
  async pollAwaitingBusy(limit = 100): Promise<ProcessOutcome[]> {
    if (!this.adapter.capabilities().getTransactionStatus) return [];
    const outcomes: ProcessOutcome[] = [];

    for (const item of this.queue.awaitingBusy(limit)) {
      try {
        const result = await this.adapter.getTransactionStatus(item.externalReference);
        if (result.status === 'POSTED' || result.status === 'DUPLICATE') {
          this.queue.markSuccess(item.id, result.busyReference ?? null);
          this.recordMasterMappingFromResult(item, result);
          this.audit.record({
            queueId: item.id,
            entityType: item.entityType,
            mesEntityId: item.mesEntityId,
            externalReference: item.externalReference,
            operation: item.operation,
            payloadVersion: item.payloadVersion,
            attemptCount: item.attemptCount,
            actor: 'system',
            busyResponse: result.raw ?? result.message ?? null,
            busyReference: result.busyReference ?? null,
            finalStatus: 'SUCCESS',
          });
          outcomes.push({
            queueId: item.id,
            externalReference: item.externalReference,
            status: 'SUCCESS',
            busyReference: result.busyReference ?? null,
          });
        } else if (result.status === 'REJECTED') {
          outcomes.push(
            this.applyFailure(
              item,
              new BridgeError('BUSY_TRANSACTION_ERROR', result.message ?? 'BUSY rejected the imported file.', {
                busyResponse: result.raw,
              }),
              item.attemptCount,
              'system',
            ),
          );
        }
        // ACCEPTED / UNKNOWN: still in flight, leave it parked.
      } catch (err) {
        const be = classifyError(err);
        log.debug('Could not poll BUSY acknowledgement', {
          externalReference: item.externalReference,
          code: be.code,
        });
      }
    }
    return outcomes;
  }
}
