import { BridgeError, UnsupportedOperationError } from '../../errors';
import type {
  BusyMasterRecord,
  BusyResult,
  BusyTransactionSnapshot,
  MesCustomer,
  MesDispatch,
  MesInvoice,
  MesItem,
  MesPurchaseReference,
  MesSalesReference,
  MesVendor,
} from '../../domain/types';
import type { AdapterCapabilities, BusyAdapter, ConnectionStatus, SendContext } from '../BusyAdapter';

/**
 * In-process fake BUSY, for tests and local development.
 *
 * It is a real implementation of the contract, not a stub: it enforces
 * idempotency, can be taken offline, can be made to time out, and refuses
 * operations its capability matrix says it cannot do. That is what makes the
 * offline/retry/duplicate tests meaningful rather than decorative.
 *
 * Never select this adapter in production — `registry.ts` refuses to.
 */
export class InMemoryBusyAdapter implements BusyAdapter {
  readonly name = 'memory';

  /** Flip to simulate BUSY being down. */
  online = true;
  /** Flip to simulate a hung BUSY. */
  timeoutNext = false;
  /** Number of times to fail with a connection error before succeeding. */
  failuresBeforeSuccess = 0;
  /** Operations to report as unsupported, to exercise capability handling. */
  unsupported = new Set<string>();
  /** Set when the send should complete synchronously with a reference. */
  synchronous = true;

  readonly transactions = new Map<string, BusyTransactionSnapshot & { status: BusyResult['status'] }>();
  readonly customers = new Map<string, BusyMasterRecord>();
  readonly vendors = new Map<string, BusyMasterRecord>();
  readonly items = new Map<string, BusyMasterRecord>();
  /** Every send attempt, so tests can assert no duplicate reached BUSY. */
  readonly sendLog: Array<{ operation: string; externalReference: string }> = [];

  private sequence = 0;

  capabilities(): AdapterCapabilities {
    const on = (op: string) => !this.unsupported.has(op);
    return {
      testConnection: true,
      getCustomers: on('getCustomers'),
      getVendors: on('getVendors'),
      getItems: on('getItems'),
      createOrUpdateCustomer: on('createOrUpdateCustomer'),
      createOrUpdateVendor: on('createOrUpdateVendor'),
      createOrUpdateItem: on('createOrUpdateItem'),
      sendSalesReference: on('sendSalesReference'),
      sendPurchaseReference: on('sendPurchaseReference'),
      sendDispatch: on('sendDispatch'),
      sendInvoice: on('sendInvoice'),
      getTransactionStatus: on('getTransactionStatus'),
      reconcileTransaction: on('reconcileTransaction'),
      synchronousSend: this.synchronous,
    };
  }

  /**
   * Availability guard, applied to every operation including read-only ones.
   *
   * `online = false` means BUSY is down, so nothing works — which is what the
   * offline scenario needs.
   */
  private guard(operation: string): void {
    if (this.unsupported.has(operation)) throw new UnsupportedOperationError(operation, this.name);
    if (!this.online) {
      throw new BridgeError('CONNECTION_ERROR', 'Simulated BUSY offline.');
    }
  }

  /**
   * Write guard: availability, plus the injected faults.
   *
   * Faults are deliberately scoped to writes. The status probe that guards
   * idempotency runs before every send, and if it consumed the injected fault
   * the send itself would succeed — a network-interruption test would then
   * silently assert nothing. Scoping faults to the write keeps each scenario
   * testing what it claims to test.
   */
  private guardWrite(operation: string): void {
    this.guard(operation);
    if (this.timeoutNext) {
      this.timeoutNext = false;
      throw new BridgeError('TIMEOUT', 'Simulated BUSY timeout.');
    }
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new BridgeError('CONNECTION_ERROR', 'Simulated transient BUSY connection failure.');
    }
  }

  async testConnection(): Promise<ConnectionStatus> {
    return this.online
      ? { online: true, message: 'In-memory BUSY is online.' }
      : { online: false, message: 'In-memory BUSY is offline.' };
  }

  async getCustomers(): Promise<BusyMasterRecord[]> {
    this.guard('getCustomers');
    return [...this.customers.values()];
  }
  async getVendors(): Promise<BusyMasterRecord[]> {
    this.guard('getVendors');
    return [...this.vendors.values()];
  }
  async getItems(): Promise<BusyMasterRecord[]> {
    this.guard('getItems');
    return [...this.items.values()];
  }

  private record(
    operation: string,
    ctx: SendContext,
    snapshot: Partial<BusyTransactionSnapshot>,
    store?: Map<string, BusyMasterRecord>,
    master?: { mesId: string; name: string },
  ): BusyResult {
    this.guardWrite(operation);
    this.sendLog.push({ operation, externalReference: ctx.externalReference });

    // Idempotency, enforced on the BUSY side too — this is what the duplicate
    // test actually proves.
    const existing = this.transactions.get(ctx.externalReference);
    if (existing) {
      return {
        status: 'DUPLICATE',
        ...(existing.busyReference ? { busyReference: existing.busyReference } : {}),
        message: `External reference ${ctx.externalReference} already exists in BUSY.`,
      };
    }

    this.sequence += 1;
    const busyReference = `BUSY-${String(this.sequence).padStart(5, '0')}`;
    const stored = { externalReference: ctx.externalReference, busyReference, ...snapshot };

    if (this.synchronous) {
      this.transactions.set(ctx.externalReference, { ...stored, status: 'POSTED' });
      if (store && master) {
        store.set(master.mesId, { busyId: busyReference, busyCode: busyReference, name: master.name });
      }
      return { status: 'POSTED', busyReference, busyCode: busyReference, raw: JSON.stringify(stored) };
    }

    this.transactions.set(ctx.externalReference, { ...stored, status: 'ACCEPTED' });
    return { status: 'ACCEPTED', message: 'Queued inside the in-memory BUSY.' };
  }

  async createOrUpdateCustomer(c: MesCustomer, ctx: SendContext): Promise<BusyResult> {
    return this.record('createOrUpdateCustomer', ctx, { documentNumber: c.code ?? c.mesId }, this.customers, {
      mesId: c.mesId,
      name: c.name,
    });
  }
  async createOrUpdateVendor(v: MesVendor, ctx: SendContext): Promise<BusyResult> {
    return this.record('createOrUpdateVendor', ctx, { documentNumber: v.code ?? v.mesId }, this.vendors, {
      mesId: v.mesId,
      name: v.name,
    });
  }
  async createOrUpdateItem(i: MesItem, ctx: SendContext): Promise<BusyResult> {
    return this.record('createOrUpdateItem', ctx, { documentNumber: i.code ?? i.mesId }, this.items, {
      mesId: i.mesId,
      name: i.name,
    });
  }

  private document(
    operation: string,
    doc: { documentNumber: string; documentDate: string; lines: Array<{ itemMesId: string; quantity: number; rate?: number; amount?: number }> },
    ctx: SendContext,
  ): BusyResult {
    const lines = doc.lines.map((l) => ({
      busyItemId: ctx.itemBusyIds[l.itemMesId]?.busyId ?? l.itemMesId,
      quantity: l.quantity,
      amount: l.amount ?? (l.rate !== undefined ? l.rate * l.quantity : undefined),
    })) as Array<{ busyItemId: string; quantity: number; amount?: number }>;

    return this.record(operation, ctx, {
      documentNumber: doc.documentNumber,
      documentDate: doc.documentDate,
      ...(ctx.partyBusyId ? { partyBusyId: ctx.partyBusyId } : {}),
      lines,
      totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
      totalAmount: lines.reduce((s, l) => s + (l.amount ?? 0), 0),
    });
  }

  async sendSalesReference(d: MesSalesReference, ctx: SendContext) {
    return this.document('sendSalesReference', d, ctx);
  }
  async sendPurchaseReference(d: MesPurchaseReference, ctx: SendContext) {
    return this.document('sendPurchaseReference', d, ctx);
  }
  async sendDispatch(d: MesDispatch, ctx: SendContext) {
    return this.document('sendDispatch', d, ctx);
  }
  async sendInvoice(d: MesInvoice, ctx: SendContext) {
    return this.document('sendInvoice', d, ctx);
  }

  async getTransactionStatus(externalReference: string): Promise<BusyResult> {
    this.guard('getTransactionStatus');
    const tx = this.transactions.get(externalReference);
    if (!tx) return { status: 'UNKNOWN', message: `No record of ${externalReference}.` };
    return {
      status: tx.status,
      ...(tx.busyReference ? { busyReference: tx.busyReference } : {}),
      raw: JSON.stringify(tx),
    };
  }

  async reconcileTransaction(externalReference: string): Promise<BusyTransactionSnapshot | null> {
    this.guard('reconcileTransaction');
    return this.transactions.get(externalReference) ?? null;
  }

  /** Test helper: pretend BUSY finished importing a previously ACCEPTED file. */
  completeAsync(externalReference: string): string | null {
    const tx = this.transactions.get(externalReference);
    if (!tx) return null;
    tx.status = 'POSTED';
    return tx.busyReference ?? null;
  }
}
