import type { SendContext } from '../adapters/BusyAdapter';
import { MappingError } from '../errors';
import type {
  MesCustomer,
  MesDispatch,
  MesDocumentLine,
  MesInvoice,
  MesItem,
  MesPurchaseReference,
  MesSalesReference,
  MesVendor,
} from '../domain/types';

/**
 * MES -> BUSY XML transformation.
 *
 * IMPORTANT, and stated here rather than buried in a ticket: the element names
 * below follow BUSY's Data Export/Import structure as described in the audit,
 * but they have NOT yet been validated against a sample export from the
 * customer's actual installation (docs/BUSY_INTEGRATION.md section 6.3 is still
 * open). BUSY's XML dialect varies by version and edition.
 *
 * This is the ONLY file that needs to change when real samples arrive. Nothing
 * downstream parses these names, so correcting them is a contained edit.
 */

export const PAYLOAD_VERSION = 1;

/** XML text escaping. Applied to every interpolated value without exception. */
export function esc(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters that are illegal in XML 1.0 and would make BUSY
    // reject the whole file over one stray byte in a free-text remark.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function tag(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return `<${name}>${esc(value)}</${name}>`;
}

function optionalTags(pairs: Array<[string, unknown]>, indent: string): string {
  return pairs
    .map(([k, v]) => tag(k, v))
    .filter(Boolean)
    .map((t) => `${indent}${t}`)
    .join('\n');
}

function busyDate(iso: string | undefined): string {
  // BUSY's import format is DD-MM-YYYY.
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}-${m}-${y}`;
}

function envelope(company: string, kind: 'MASTERS' | 'VOUCHERS', externalReference: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<BUSYDATA>
  <HEADER>
    <COMPANY>${esc(company)}</COMPANY>
    <DATATYPE>${kind}</DATATYPE>
    <SOURCE>DHOWN-MES</SOURCE>
    <EXTERNALREFERENCE>${esc(externalReference)}</EXTERNALREFERENCE>
    <PAYLOADVERSION>${PAYLOAD_VERSION}</PAYLOADVERSION>
    <GENERATEDAT>${esc(new Date().toISOString())}</GENERATEDAT>
  </HEADER>
  <BODY>
${body}
  </BODY>
</BUSYDATA>
`;
}

/**
 * Resolve a document line's item to its BUSY identity.
 * Throws MASTER_MAPPING_ERROR naming the offending MES item, which is what
 * produces the operator message in the spec's example.
 */
function resolveLineItem(line: MesDocumentLine, ctx: SendContext): { busyId: string; busyCode?: string } {
  const resolved = ctx.itemBusyIds[line.itemMesId];
  if (!resolved) throw new MappingError('ITEM', line.itemMesId);
  return resolved;
}

function renderLines(lines: MesDocumentLine[], ctx: SendContext): string {
  return lines
    .map((line, index) => {
      const item = resolveLineItem(line, ctx);
      const amount = line.amount ?? (line.rate !== undefined ? +(line.rate * line.quantity).toFixed(2) : undefined);
      return `      <ITEM>
        <SRNO>${index + 1}</SRNO>
        <ITEMCODE>${esc(item.busyCode ?? item.busyId)}</ITEMCODE>
        <ITEMID>${esc(item.busyId)}</ITEMID>
        <QTY>${esc(line.quantity)}</QTY>
        <UNIT>${esc(line.unit)}</UNIT>
${optionalTags(
  [
    ['RATE', line.rate],
    ['DISCOUNTPERCENT', line.discountPercent],
    ['AMOUNT', amount],
    ['HSNCODE', line.hsnCode],
    ['GSTRATE', line.gstRate],
    ['REMARK', line.remark],
  ],
  '        ',
)}
      </ITEM>`;
    })
    .join('\n');
}

function requireParty(ctx: SendContext, entityType: 'CUSTOMER' | 'VENDOR', mesId: string): string {
  if (!ctx.partyBusyId) throw new MappingError(entityType, mesId);
  return ctx.partyBusyId;
}

// --- Masters ---------------------------------------------------------------

export function customerToXml(c: MesCustomer, ctx: SendContext, company: string): string {
  const addr = c.billingAddress ?? {};
  const body = `    <ACCOUNT>
      <ACTION>UPSERT</ACTION>
      <EXTERNALID>${esc(c.mesId)}</EXTERNALID>
      <NAME>${esc(c.name)}</NAME>
      <GROUP>Sundry Debtors</GROUP>
${optionalTags(
  [
    ['CODE', ctx.partyBusyCode ?? c.code],
    ['BUSYID', ctx.partyBusyId],
    ['GSTIN', c.gstin?.toUpperCase()],
    ['PAN', c.pan?.toUpperCase()],
    ['EMAIL', c.email],
    ['PHONE', c.phone],
    ['ADDRESS1', addr.line1],
    ['ADDRESS2', addr.line2],
    ['CITY', addr.city],
    ['STATE', addr.state],
    ['STATECODE', addr.stateCode],
    ['PINCODE', addr.pincode],
    ['COUNTRY', addr.country ?? 'India'],
    ['CREDITDAYS', c.creditDays],
    ['CREDITLIMIT', c.creditLimit],
    ['ACTIVE', c.active === false ? 'N' : 'Y'],
  ],
  '      ',
)}
    </ACCOUNT>`;
  return envelope(company, 'MASTERS', ctx.externalReference, body);
}

export function vendorToXml(v: MesVendor, ctx: SendContext, company: string): string {
  const addr = v.address ?? {};
  const body = `    <ACCOUNT>
      <ACTION>UPSERT</ACTION>
      <EXTERNALID>${esc(v.mesId)}</EXTERNALID>
      <NAME>${esc(v.name)}</NAME>
      <GROUP>Sundry Creditors</GROUP>
${optionalTags(
  [
    ['CODE', ctx.partyBusyCode ?? v.code],
    ['BUSYID', ctx.partyBusyId],
    ['GSTIN', v.gstin?.toUpperCase()],
    ['PAN', v.pan?.toUpperCase()],
    ['EMAIL', v.email],
    ['PHONE', v.phone],
    ['ADDRESS1', addr.line1],
    ['CITY', addr.city],
    ['STATE', addr.state],
    ['STATECODE', addr.stateCode],
    ['PINCODE', addr.pincode],
    ['COUNTRY', addr.country ?? 'India'],
    ['ACTIVE', v.active === false ? 'N' : 'Y'],
  ],
  '      ',
)}
    </ACCOUNT>`;
  return envelope(company, 'MASTERS', ctx.externalReference, body);
}

export function itemToXml(i: MesItem, ctx: SendContext, company: string): string {
  const body = `    <STOCKITEM>
      <ACTION>UPSERT</ACTION>
      <EXTERNALID>${esc(i.mesId)}</EXTERNALID>
      <NAME>${esc(i.name)}</NAME>
      <UNIT>${esc(i.unit)}</UNIT>
${optionalTags(
  [
    ['CODE', i.code],
    ['BUSYID', ctx.itemBusyIds[i.mesId]?.busyId],
    ['GROUP', i.group],
    ['HSNCODE', i.hsnCode],
    ['GSTRATE', i.gstRate],
    ['ACTIVE', i.active === false ? 'N' : 'Y'],
  ],
  '      ',
)}
    </STOCKITEM>`;
  return envelope(company, 'MASTERS', ctx.externalReference, body);
}

// --- Vouchers --------------------------------------------------------------

function voucher(
  voucherType: string,
  doc: {
    documentNumber: string;
    documentDate: string;
    notes?: string;
    currency?: string;
    lines: MesDocumentLine[];
  },
  partyBusyId: string,
  ctx: SendContext,
  extra: Array<[string, unknown]>,
  company: string,
): string {
  const body = `    <VOUCHER>
      <VOUCHERTYPE>${esc(voucherType)}</VOUCHERTYPE>
      <ACTION>CREATE</ACTION>
      <EXTERNALREFERENCE>${esc(ctx.externalReference)}</EXTERNALREFERENCE>
      <VOUCHERNO>${esc(doc.documentNumber)}</VOUCHERNO>
      <DATE>${esc(busyDate(doc.documentDate))}</DATE>
      <PARTYID>${esc(partyBusyId)}</PARTYID>
${optionalTags(
  [
    ['PARTYCODE', ctx.partyBusyCode],
    ['WAREHOUSEID', ctx.warehouseBusyId],
    ['CURRENCY', doc.currency ?? 'INR'],
    ...extra,
    ['NARRATION', doc.notes],
  ],
  '      ',
)}
      <ITEMS>
${renderLines(doc.lines, ctx)}
      </ITEMS>
    </VOUCHER>`;
  return envelope(company, 'VOUCHERS', ctx.externalReference, body);
}

export function salesReferenceToXml(d: MesSalesReference, ctx: SendContext, company: string): string {
  return voucher(
    'Sales Order',
    d,
    requireParty(ctx, 'CUSTOMER', d.customerMesId),
    ctx,
    [
      ['BUYERORDERNO', d.buyerOrderNumber],
      ['BUYERORDERDATE', busyDate(d.buyerOrderDate)],
    ],
    company,
  );
}

export function purchaseReferenceToXml(d: MesPurchaseReference, ctx: SendContext, company: string): string {
  return voucher(
    'Purchase Order',
    d,
    requireParty(ctx, 'VENDOR', d.vendorMesId),
    ctx,
    [['VENDORINVOICENO', d.vendorInvoiceNumber]],
    company,
  );
}

export function dispatchToXml(d: MesDispatch, ctx: SendContext, company: string): string {
  // Material Issue / Delivery Challan: stock leaves, the invoice follows.
  return voucher(
    'Delivery Challan',
    d,
    requireParty(ctx, 'CUSTOMER', d.customerMesId),
    ctx,
    [
      ['VEHICLENO', d.vehicleNumber],
      ['TRANSPORTER', d.transporterName],
      ['LRNO', d.lrNumber],
      ['EWAYBILLNO', d.eWayBillNumber],
      ['DISPATCHEDAT', d.dispatchedAt],
      ['AGAINSTORDER', d.salesReferenceMesId],
    ],
    company,
  );
}

export function invoiceToXml(d: MesInvoice, ctx: SendContext, company: string): string {
  return voucher(
    'Sales',
    d,
    requireParty(ctx, 'CUSTOMER', d.customerMesId),
    ctx,
    [
      ['AGAINSTCHALLAN', d.dispatchMesId],
      ['PLACEOFSUPPLY', d.placeOfSupply],
      ['TAXABLEAMOUNT', d.taxableAmount],
      ['TAXAMOUNT', d.taxAmount],
      ['TOTALAMOUNT', d.totalAmount],
    ],
    company,
  );
}
