import type { Config, EntityType } from './config';
import { openDatabase, type Db } from './db';
import { createAdapter } from './adapters/registry';
import type { BusyAdapter } from './adapters/BusyAdapter';
import { MappingStore, type MappingEntityType } from './mapping/mappingStore';
import { QueueStore, type QueueItem } from './queue/queueStore';
import { RetryPolicy } from './queue/retryPolicy';
import { SyncService } from './queue/syncService';
import { QueueWorker } from './queue/worker';
import { AuditLog } from './audit/auditLog';
import { Reconciler } from './reconcile/reconciler';
import { validatePayload } from './validation/validators';
import { buildExternalReference, buildMasterExternalReference } from './domain/externalRef';
import { BridgeError } from './errors';
import { PAYLOAD_VERSION } from './transform/busyXml';
import type { MesDocumentLine, SyncOperation } from './domain/types';
import { log } from './logger';

/**
 * Composition root and the bridge's own public surface.
 *
 * MES calls submit(). Everything after that — validation, mapping, queueing,
 * retrying, reconciling — happens here, asynchronously, without MES waiting.
 */

const MASTER_TYPES: ReadonlySet<EntityType> = new Set<EntityType>(['CUSTOMER', 'VENDOR', 'ITEM', 'WAREHOUSE']);

export interface SubmitInput {
  entityType: EntityType;
  payload: Record<string, unknown>;
  operation?: SyncOperation;
  /** Overrides the derived idempotency key. Rarely needed; MES may supply its own. */
  externalReference?: string;
  createdBy?: string;
}

export interface SubmitResult {
  accepted: true;
  queueId: number;
  externalReference: string;
  status: QueueItem['status'];
  /** False when this external reference was already queued — a safe no-op. */
  created: boolean;
  busyReference: string | null;
}

export class Bridge {
  readonly db: Db;
  readonly adapter: BusyAdapter;
  readonly mappings: MappingStore;
  readonly queue: QueueStore;
  readonly audit: AuditLog;
  readonly sync: SyncService;
  readonly worker: QueueWorker;
  readonly reconciler: Reconciler;
  readonly retryPolicy: RetryPolicy;

  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly config: Config,
    /** Injectable so tests can drive a controllable BUSY. */
    adapter?: BusyAdapter,
  ) {
    this.db = openDatabase(config.databasePath);
    this.adapter = adapter ?? createAdapter(config);
    this.mappings = new MappingStore(this.db);
    this.queue = new QueueStore(this.db);
    this.audit = new AuditLog(this.db);
    this.retryPolicy = new RetryPolicy({
      maxAttempts: config.queue.maxAttempts,
      baseDelayMs: config.queue.retryBaseDelayMs,
      maxDelayMs: config.queue.retryMaxDelayMs,
    });
    this.sync = new SyncService({
      adapter: this.adapter,
      queue: this.queue,
      mappings: this.mappings,
      audit: this.audit,
      retryPolicy: this.retryPolicy,
    });
    this.worker = new QueueWorker(this.db, this.queue, this.sync, this.adapter, {
      pollIntervalMs: config.queue.pollIntervalMs,
      batchSize: config.queue.batchSize,
    });
    this.reconciler = new Reconciler(this.db, this.adapter, this.queue, this.mappings);
  }

  /**
   * Accept a commercial record from MES.
   *
   * Synchronous work is deliberately limited to validation and queueing, both
   * of which are local. MES is never blocked on BUSY — that is what keeps
   * production running during a BUSY outage.
   */
  submit(input: SubmitInput): SubmitResult {
    const { entityType, payload } = input;

    // The transaction list is configurable per the spec; anything not enabled
    // is refused here rather than silently dropped later.
    if (!this.config.enabledEntityTypes.has(entityType)) {
      throw new BridgeError(
        'VALIDATION_ERROR',
        `Entity type "${entityType}" is not enabled for BUSY synchronisation.`,
        { action: 'CONTACT_SUPPORT', subject: entityType, enabled: [...this.config.enabledEntityTypes] },
      );
    }

    validatePayload(entityType, payload);

    const mesEntityId = String(payload.mesId);
    const externalReference =
      input.externalReference ??
      (MASTER_TYPES.has(entityType)
        ? buildMasterExternalReference(entityType, mesEntityId)
        : buildExternalReference(
            entityType,
            String(payload.documentNumber),
            payload.fiscalYear as string | undefined,
          ));

    this.registerMappingPlaceholders(entityType, payload, mesEntityId);

    const { item, created } = this.queue.enqueue({
      entityType,
      mesEntityId,
      operation: input.operation ?? (MASTER_TYPES.has(entityType) ? 'UPSERT' : 'SEND'),
      payload,
      payloadVersion: PAYLOAD_VERSION,
      externalReference,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    });

    if (created) {
      this.audit.record({
        queueId: item.id,
        entityType,
        mesEntityId,
        externalReference,
        operation: item.operation,
        payloadVersion: PAYLOAD_VERSION,
        payloadSnapshot: item.payload,
        actor: input.createdBy ?? 'MES',
        finalStatus: 'QUEUED',
      });
    } else {
      // Idempotent re-submission. Not an error: MES retried, and we already
      // hold the record. Returning the existing state lets MES converge.
      log.info('Duplicate submission ignored', { externalReference, queueId: item.id });
    }

    return {
      accepted: true,
      queueId: item.id,
      externalReference,
      status: item.status,
      created,
      busyReference: item.busyReference,
    };
  }

  /**
   * Make sure every MES id referenced by this payload has a mapping row, even
   * an unmapped one. Without this, an operator has nothing to click "Fix
   * Mapping" on — the gap would only exist as an error message.
   */
  private registerMappingPlaceholders(
    entityType: EntityType,
    payload: Record<string, unknown>,
    mesEntityId: string,
  ): void {
    if (MASTER_TYPES.has(entityType)) {
      this.mappings.upsertPending(entityType as MappingEntityType, mesEntityId, payload.name as string | undefined);
    }
    if (typeof payload.customerMesId === 'string') {
      this.mappings.upsertPending('CUSTOMER', payload.customerMesId);
    }
    if (typeof payload.vendorMesId === 'string') {
      this.mappings.upsertPending('VENDOR', payload.vendorMesId);
    }
    if (typeof payload.warehouseMesId === 'string') {
      this.mappings.upsertPending('WAREHOUSE', payload.warehouseMesId);
    }
    const lines = payload.lines as MesDocumentLine[] | undefined;
    if (Array.isArray(lines)) {
      for (const line of lines) {
        if (line?.itemMesId) this.mappings.upsertPending('ITEM', line.itemMesId);
      }
    }
  }

  /** Force one queue item through immediately. Used by manual retry and tests. */
  async processOne(queueId: number, actor = 'system') {
    const item = this.queue.findById(queueId);
    if (!item) throw new BridgeError('VALIDATION_ERROR', `Queue item ${queueId} does not exist.`);
    return this.sync.process(item, actor);
  }

  /** Drain the queue until nothing is due. Used by tests and by manual "run now". */
  async drain(maxPasses = 20): Promise<number> {
    let processed = 0;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const batch = this.queue.claimBatch(this.config.queue.batchSize);
      if (batch.length === 0) break;
      for (const item of batch) {
        await this.sync.process(item);
        processed += 1;
      }
    }
    await this.sync.pollAwaitingBusy();
    return processed;
  }

  start(): void {
    this.worker.start();
    if (this.config.reconcile.intervalMs > 0) {
      this.reconcileTimer = setInterval(() => {
        void this.reconciler.run(this.config.reconcile.lookbackDays).catch((err) => {
          log.error('Scheduled reconciliation failed', { message: String(err) });
        });
      }, this.config.reconcile.intervalMs);
      this.reconcileTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    await this.worker.stop();
    await this.adapter.close?.();
    this.db.close();
  }
}
