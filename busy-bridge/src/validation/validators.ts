import type { EntityType } from '../config';
import { ValidationError } from '../errors';
import type {
  MesCustomer,
  MesDispatch,
  MesDocumentLine,
  MesInvoice,
  MesItem,
  MesPurchaseReference,
  MesSalesReference,
  MesVendor,
  MesWarehouse,
} from '../domain/types';

/**
 * Validation runs BEFORE anything is queued.
 *
 * Rejecting bad data at the MES boundary is much cheaper than discovering it
 * four retries later, and it keeps the queue free of jobs that can never
 * succeed. Validation failures are NOT retryable.
 */

// GSTIN: 2-digit state code, 10-char PAN, entity digit, 'Z', checksum char.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class Issues {
  readonly list: string[] = [];
  add(message: string): void {
    this.list.push(message);
  }
  required(value: unknown, field: string): void {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      this.add(`${field} is required`);
    }
  }
  throwIfAny(subject: string, what: string): void {
    if (this.list.length > 0) {
      throw new ValidationError(`${what} failed validation: ${this.list.join('; ')}`, this.list, subject);
    }
  }
}

function checkGstin(issues: Issues, gstin: string | undefined, field = 'gstin'): void {
  if (gstin && !GSTIN_PATTERN.test(gstin.toUpperCase())) {
    issues.add(`${field} "${gstin}" is not a valid 15-character GSTIN`);
  }
}

function checkPan(issues: Issues, pan: string | undefined): void {
  if (pan && !PAN_PATTERN.test(pan.toUpperCase())) {
    issues.add(`pan "${pan}" is not a valid PAN`);
  }
}

function checkDate(issues: Issues, value: string | undefined, field: string, required = false): void {
  if (!value) {
    if (required) issues.add(`${field} is required`);
    return;
  }
  if (!DATE_PATTERN.test(value)) {
    issues.add(`${field} must be an ISO date (YYYY-MM-DD), got "${value}"`);
    return;
  }
  if (Number.isNaN(Date.parse(value))) {
    issues.add(`${field} "${value}" is not a real date`);
  }
}

function checkLines(issues: Issues, lines: MesDocumentLine[] | undefined): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    issues.add('lines must contain at least one item');
    return;
  }
  lines.forEach((line, i) => {
    const at = `lines[${i}]`;
    issues.required(line.itemMesId, `${at}.itemMesId`);
    issues.required(line.unit, `${at}.unit`);
    if (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity)) {
      issues.add(`${at}.quantity must be a number`);
    } else if (line.quantity <= 0) {
      // A zero or negative dispatch line is either a data-entry slip or an
      // attempted credit note. Neither should be posted as a dispatch.
      issues.add(`${at}.quantity must be greater than zero (got ${line.quantity})`);
    }
    if (line.rate !== undefined && (typeof line.rate !== 'number' || line.rate < 0)) {
      issues.add(`${at}.rate must be a non-negative number`);
    }
    if (line.gstRate !== undefined && (typeof line.gstRate !== 'number' || line.gstRate < 0 || line.gstRate > 100)) {
      issues.add(`${at}.gstRate must be between 0 and 100`);
    }
  });
}

export function validateCustomer(c: MesCustomer): void {
  const issues = new Issues();
  issues.required(c.mesId, 'mesId');
  issues.required(c.name, 'name');
  checkGstin(issues, c.gstin);
  checkPan(issues, c.pan);
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) issues.add(`email "${c.email}" is not valid`);
  if (c.creditDays !== undefined && (!Number.isInteger(c.creditDays) || c.creditDays < 0)) {
    issues.add('creditDays must be a non-negative integer');
  }
  issues.throwIfAny(c.mesId ?? c.name ?? 'customer', 'Customer');
}

export function validateVendor(v: MesVendor): void {
  const issues = new Issues();
  issues.required(v.mesId, 'mesId');
  issues.required(v.name, 'name');
  checkGstin(issues, v.gstin);
  checkPan(issues, v.pan);
  issues.throwIfAny(v.mesId ?? v.name ?? 'vendor', 'Vendor');
}

export function validateItem(i: MesItem): void {
  const issues = new Issues();
  issues.required(i.mesId, 'mesId');
  issues.required(i.name, 'name');
  issues.required(i.unit, 'unit');
  if (i.hsnCode && !/^\d{4,8}$/.test(i.hsnCode)) issues.add(`hsnCode "${i.hsnCode}" must be 4-8 digits`);
  if (i.gstRate !== undefined && (typeof i.gstRate !== 'number' || i.gstRate < 0 || i.gstRate > 100)) {
    issues.add('gstRate must be between 0 and 100');
  }
  issues.throwIfAny(i.mesId ?? i.name ?? 'item', 'Item');
}

export function validateWarehouse(w: MesWarehouse): void {
  const issues = new Issues();
  issues.required(w.mesId, 'mesId');
  issues.required(w.name, 'name');
  issues.throwIfAny(w.mesId ?? w.name ?? 'warehouse', 'Warehouse');
}

export function validateSalesReference(d: MesSalesReference): void {
  const issues = new Issues();
  issues.required(d.mesId, 'mesId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.customerMesId, 'customerMesId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkDate(issues, d.buyerOrderDate, 'buyerOrderDate');
  checkLines(issues, d.lines);
  issues.throwIfAny(d.documentNumber ?? d.mesId ?? 'sales reference', 'Sales reference');
}

export function validatePurchaseReference(d: MesPurchaseReference): void {
  const issues = new Issues();
  issues.required(d.mesId, 'mesId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.vendorMesId, 'vendorMesId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkLines(issues, d.lines);
  issues.throwIfAny(d.documentNumber ?? d.mesId ?? 'purchase reference', 'Purchase reference');
}

export function validateDispatch(d: MesDispatch): void {
  const issues = new Issues();
  issues.required(d.mesId, 'mesId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.customerMesId, 'customerMesId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkLines(issues, d.lines);
  if (d.eWayBillNumber && !/^\d{12}$/.test(d.eWayBillNumber)) {
    issues.add(`eWayBillNumber "${d.eWayBillNumber}" must be 12 digits`);
  }
  issues.throwIfAny(d.documentNumber ?? d.mesId ?? 'dispatch', 'Dispatch');
}

export function validateInvoice(d: MesInvoice): void {
  const issues = new Issues();
  issues.required(d.mesId, 'mesId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.customerMesId, 'customerMesId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkLines(issues, d.lines);

  // If MES states the totals, they must agree with the lines. BUSY recomputes
  // tax itself, so a disagreement here means MES and BUSY would end up with
  // different books — better to reject than to reconcile a mismatch later.
  if (d.taxableAmount !== undefined && Array.isArray(d.lines) && d.lines.length > 0) {
    const computed = d.lines.reduce((sum, l) => {
      const amount = l.amount ?? (l.rate ?? 0) * (l.quantity ?? 0);
      return sum + amount;
    }, 0);
    if (Math.abs(computed - d.taxableAmount) > 1) {
      issues.add(
        `taxableAmount ${d.taxableAmount} does not match the sum of line amounts ${computed.toFixed(2)}`,
      );
    }
  }
  issues.throwIfAny(d.documentNumber ?? d.mesId ?? 'invoice', 'Invoice');
}

const VALIDATORS: Record<EntityType, (payload: any) => void> = {
  CUSTOMER: validateCustomer,
  VENDOR: validateVendor,
  ITEM: validateItem,
  WAREHOUSE: validateWarehouse,
  SALES_REFERENCE: validateSalesReference,
  PURCHASE_REFERENCE: validatePurchaseReference,
  DISPATCH: validateDispatch,
  INVOICE: validateInvoice,
};

export function validatePayload(entityType: EntityType, payload: unknown): void {
  const validator = VALIDATORS[entityType];
  if (!validator) {
    throw new ValidationError(`No validator registered for entity type "${entityType}".`, ['entityType'], entityType);
  }
  if (payload === null || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object.', ['payload'], entityType);
  }
  validator(payload);
}
