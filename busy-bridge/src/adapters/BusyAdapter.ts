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
} from '../domain/types';

/**
 * THE replaceable boundary.
 *
 * Everything BUSY-specific lives behind this interface. The queue, the retry
 * engine, the mapping store, the reconciler and the API know nothing about
 * XML, REST, SQL or file shares — they only know these thirteen operations.
 *
 * Swapping BUSY transports means writing one new class here and changing one
 * environment variable. If a new adapter ever forces a change outside
 * src/adapters/, the abstraction has leaked and that is the bug to fix.
 *
 * Operations an installation cannot perform MUST throw UnsupportedOperationError.
 * They must never be faked and must never quietly succeed — a fake success
 * would put a wrong reference into MES and corrupt reconciliation.
 */

export interface AdapterCapabilities {
  testConnection: boolean;
  getCustomers: boolean;
  getVendors: boolean;
  getItems: boolean;
  createOrUpdateCustomer: boolean;
  createOrUpdateVendor: boolean;
  createOrUpdateItem: boolean;
  sendSalesReference: boolean;
  sendPurchaseReference: boolean;
  sendDispatch: boolean;
  sendInvoice: boolean;
  getTransactionStatus: boolean;
  reconcileTransaction: boolean;
  /**
   * True when sends complete synchronously and return a BUSY reference
   * immediately. False for file-drop transports, where the reference only
   * arrives later and the queue must park the job in AWAITING_BUSY.
   */
  synchronousSend: boolean;
}

export interface ConnectionStatus {
  online: boolean;
  message: string;
  /** e.g. detected BUSY version/edition, share path, gateway build. */
  detail?: Record<string, unknown>;
}

/** Context carried into every send so the adapter can address BUSY correctly. */
export interface SendContext {
  externalReference: string;
  /** BUSY id of the customer/vendor, already resolved via the mapping table. */
  partyBusyId?: string;
  partyBusyCode?: string;
  /** MES item id -> BUSY item id/code, already resolved. */
  itemBusyIds: Record<string, { busyId: string; busyCode?: string }>;
  warehouseBusyId?: string;
  attempt: number;
}

export interface BusyAdapter {
  /** Stable identifier used in config, logs and the dashboard. */
  readonly name: string;

  /** What this installation can actually do. Must be truthful. */
  capabilities(): AdapterCapabilities;

  testConnection(): Promise<ConnectionStatus>;

  getCustomers(since?: string): Promise<BusyMasterRecord[]>;
  getVendors(since?: string): Promise<BusyMasterRecord[]>;
  getItems(since?: string): Promise<BusyMasterRecord[]>;

  createOrUpdateCustomer(customer: MesCustomer, ctx: SendContext): Promise<BusyResult>;
  createOrUpdateVendor(vendor: MesVendor, ctx: SendContext): Promise<BusyResult>;
  createOrUpdateItem(item: MesItem, ctx: SendContext): Promise<BusyResult>;

  sendSalesReference(doc: MesSalesReference, ctx: SendContext): Promise<BusyResult>;
  sendPurchaseReference(doc: MesPurchaseReference, ctx: SendContext): Promise<BusyResult>;
  sendDispatch(doc: MesDispatch, ctx: SendContext): Promise<BusyResult>;
  sendInvoice(doc: MesInvoice, ctx: SendContext): Promise<BusyResult>;

  /**
   * Has BUSY seen this external reference, and what became of it?
   * This is what makes idempotency safe across a crash: if we died between
   * sending and recording, this tells us the truth instead of us resending.
   */
  getTransactionStatus(externalReference: string): Promise<BusyResult>;

  /** Pull BUSY's view of a transaction so the reconciler can compare. */
  reconcileTransaction(externalReference: string): Promise<BusyTransactionSnapshot | null>;

  /** Release file handles, sockets, pools. */
  close?(): Promise<void>;
}

/** Capability set with everything off — adapters spread over this. */
export const NO_CAPABILITIES: AdapterCapabilities = {
  testConnection: false,
  getCustomers: false,
  getVendors: false,
  getItems: false,
  createOrUpdateCustomer: false,
  createOrUpdateVendor: false,
  createOrUpdateItem: false,
  sendSalesReference: false,
  sendPurchaseReference: false,
  sendDispatch: false,
  sendInvoice: false,
  getTransactionStatus: false,
  reconcileTransaction: false,
  synchronousSend: false,
};
