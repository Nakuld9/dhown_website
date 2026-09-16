import type { EntityType } from '../config';

/**
 * Canonical MES-side shapes the bridge accepts.
 *
 * These are deliberately *commercial* documents only. There is no field here
 * for machine id, loom speed, shift, WIP stage or roll genealogy, and there
 * must never be: production data stays in DHOWN MES.
 */

export type { EntityType };

export type SyncOperation = 'CREATE' | 'UPDATE' | 'UPSERT' | 'SEND';

export interface MesAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  country?: string;
}

export interface MesCustomer {
  mesId: string;
  name: string;
  /** MES-side code, e.g. CUST-00042. Not assumed equal to the BUSY code. */
  code?: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  billingAddress?: MesAddress;
  shippingAddress?: MesAddress;
  creditDays?: number;
  creditLimit?: number;
  active?: boolean;
}

export interface MesVendor {
  mesId: string;
  name: string;
  code?: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  address?: MesAddress;
  active?: boolean;
}

export interface MesItem {
  mesId: string;
  name: string;
  /** MES item code, e.g. FC-00125. */
  code?: string;
  /** Stock-keeping unit of measure as MES records it, e.g. MTR, KG. */
  unit: string;
  hsnCode?: string;
  gstRate?: number;
  /** Commercial grouping only — not a production routing. */
  group?: string;
  active?: boolean;
}

export interface MesWarehouse {
  mesId: string;
  name: string;
  code?: string;
  active?: boolean;
}

export interface MesDocumentLine {
  /** MES item identifier; resolved to a BUSY item via the mapping table. */
  itemMesId: string;
  quantity: number;
  unit: string;
  rate?: number;
  discountPercent?: number;
  amount?: number;
  hsnCode?: string;
  gstRate?: number;
  /**
   * Free-text remark. Roll numbers may appear here for traceability on the
   * printed document, but the bridge attaches no meaning to them and never
   * maps them into BUSY as structured production data.
   */
  remark?: string;
}

interface MesDocumentBase {
  mesId: string;
  /** Human document number as MES prints it, e.g. DH-DSP-00091. */
  documentNumber: string;
  /** ISO-8601 date (YYYY-MM-DD). */
  documentDate: string;
  customerMesId?: string;
  vendorMesId?: string;
  warehouseMesId?: string;
  lines: MesDocumentLine[];
  currency?: string;
  notes?: string;
  /** Financial year label used in the external reference, e.g. "2026". */
  fiscalYear?: string;
}

export interface MesSalesReference extends MesDocumentBase {
  customerMesId: string;
  buyerOrderNumber?: string;
  buyerOrderDate?: string;
}

export interface MesPurchaseReference extends MesDocumentBase {
  vendorMesId: string;
  vendorInvoiceNumber?: string;
}

export interface MesDispatch extends MesDocumentBase {
  customerMesId: string;
  /** Sales reference this dispatch fulfils, if any. */
  salesReferenceMesId?: string;
  vehicleNumber?: string;
  transporterName?: string;
  lrNumber?: string;
  eWayBillNumber?: string;
  dispatchedAt?: string;
}

export interface MesInvoice extends MesDocumentBase {
  customerMesId: string;
  dispatchMesId?: string;
  taxableAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  placeOfSupply?: string;
}

export type MesPayload =
  | MesCustomer
  | MesVendor
  | MesItem
  | MesWarehouse
  | MesSalesReference
  | MesPurchaseReference
  | MesDispatch
  | MesInvoice;

/** What the adapter hands back after a send. */
export type BusyAckStatus =
  /** BUSY booked it and gave us a reference. */
  | 'POSTED'
  /** Handed over successfully, but BUSY has not confirmed yet (async XML). */
  | 'ACCEPTED'
  /** BUSY already holds this external reference. */
  | 'DUPLICATE'
  /** BUSY rejected it. */
  | 'REJECTED'
  /** We asked about a reference BUSY has never seen. */
  | 'UNKNOWN';

export interface BusyResult {
  status: BusyAckStatus;
  /** BUSY's own voucher/master reference, once known. */
  busyReference?: string;
  /** BUSY's short code for the record, e.g. a ledger or item code. */
  busyCode?: string;
  /** Verbatim response, stored in the audit trail. */
  raw?: string;
  message?: string;
}

export interface BusyMasterRecord {
  busyId: string;
  busyCode?: string;
  name: string;
  gstin?: string;
  raw?: Record<string, unknown>;
}

/** A commercial document as BUSY holds it, used for reconciliation. */
export interface BusyTransactionSnapshot {
  externalReference: string;
  busyReference?: string;
  documentNumber?: string;
  documentDate?: string;
  partyBusyId?: string;
  totalQuantity?: number;
  totalAmount?: number;
  lines?: Array<{ busyItemId: string; quantity: number; amount?: number }>;
  raw?: Record<string, unknown>;
}
