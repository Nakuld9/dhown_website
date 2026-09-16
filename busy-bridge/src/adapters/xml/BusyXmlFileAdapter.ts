import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BridgeError, classifyError, UnsupportedOperationError } from '../../errors';
import { assertSafeReference } from '../../domain/externalRef';
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
import {
  customerToXml,
  dispatchToXml,
  invoiceToXml,
  itemToXml,
  purchaseReferenceToXml,
  salesReferenceToXml,
  vendorToXml,
} from '../../transform/busyXml';
import type { AdapterCapabilities, BusyAdapter, ConnectionStatus, SendContext } from '../BusyAdapter';
import { tagBlocks, tagNumber, tagValue } from './xmlRead';

export interface XmlAdapterOptions {
  outbox: string;
  ack: string;
  inbox: string;
  archive: string;
  companyName: string;
}

/**
 * BUSY XML Data Export/Import over a watched file exchange.
 *
 * This is the default adapter, chosen because it is the only mechanism
 * confirmed to be first-party and available across BUSY editions — see
 * docs/BUSY_INTEGRATION.md.
 *
 * Asynchrony is the defining property. Writing the file does NOT mean BUSY
 * booked the voucher; it means BUSY has been handed the voucher. Sends
 * therefore return ACCEPTED, and the BUSY reference is collected later from
 * the ack directory. Claiming POSTED here would put a reference into MES that
 * BUSY never issued.
 */
export class BusyXmlFileAdapter implements BusyAdapter {
  readonly name = 'xml';

  constructor(private readonly opts: XmlAdapterOptions) {}

  capabilities(): AdapterCapabilities {
    return {
      testConnection: true,
      // Inbound masters depend on BUSY being configured to drop scheduled
      // exports into the inbox. Supported here; may legitimately be empty
      // until the BUSY side is set up (checklist 6.3).
      getCustomers: true,
      getVendors: true,
      getItems: true,
      createOrUpdateCustomer: true,
      createOrUpdateVendor: true,
      createOrUpdateItem: true,
      sendSalesReference: true,
      sendPurchaseReference: true,
      sendDispatch: true,
      sendInvoice: true,
      getTransactionStatus: true,
      reconcileTransaction: true,
      synchronousSend: false,
    };
  }

  // --- connection ----------------------------------------------------------

  async testConnection(): Promise<ConnectionStatus> {
    try {
      await fs.mkdir(this.opts.outbox, { recursive: true });
      await fs.mkdir(this.opts.ack, { recursive: true });
      await fs.mkdir(this.opts.inbox, { recursive: true });
      await fs.mkdir(this.opts.archive, { recursive: true });

      // mkdir succeeding on a stale network mount does not prove we can write.
      // Actually write, so "online" means what an operator thinks it means.
      const probe = path.join(this.opts.outbox, `.bridge-probe-${process.pid}`);
      await fs.writeFile(probe, 'ok', 'utf8');
      await fs.unlink(probe);

      const pending = (await fs.readdir(this.opts.outbox)).filter((f) => f.endsWith('.xml')).length;
      return {
        online: true,
        message: 'BUSY XML exchange directories are reachable and writable.',
        detail: { outbox: this.opts.outbox, ack: this.opts.ack, filesAwaitingBusyImport: pending },
      };
    } catch (err) {
      const be = classifyError(err);
      return {
        online: false,
        message: `BUSY XML exchange is not reachable: ${be.message}`,
        detail: { code: be.code, outbox: this.opts.outbox },
      };
    }
  }

  // --- masters in ----------------------------------------------------------

  private async readInboundMasters(kind: string, since?: string): Promise<BusyMasterRecord[]> {
    try {
      await fs.mkdir(this.opts.inbox, { recursive: true });
      const files = (await fs.readdir(this.opts.inbox)).filter(
        (f) => f.toLowerCase().endsWith('.xml') && f.toUpperCase().includes(kind),
      );
      const records: BusyMasterRecord[] = [];
      for (const file of files) {
        const full = path.join(this.opts.inbox, file);
        if (since) {
          const stat = await fs.stat(full);
          if (stat.mtime.toISOString() < since) continue;
        }
        const xml = await fs.readFile(full, 'utf8');
        for (const block of tagBlocks(xml, kind === 'ITEM' ? 'STOCKITEM' : 'ACCOUNT')) {
          const busyId = tagValue(block, 'BUSYID') ?? tagValue(block, 'CODE');
          const name = tagValue(block, 'NAME');
          if (!busyId || !name) continue; // incomplete row: skip, do not invent
          records.push({
            busyId,
            name,
            ...(tagValue(block, 'CODE') ? { busyCode: tagValue(block, 'CODE')! } : {}),
            ...(tagValue(block, 'GSTIN') ? { gstin: tagValue(block, 'GSTIN')! } : {}),
          });
        }
      }
      return records;
    } catch (err) {
      throw classifyError(err);
    }
  }

  getCustomers(since?: string): Promise<BusyMasterRecord[]> {
    return this.readInboundMasters('CUSTOMER', since);
  }
  getVendors(since?: string): Promise<BusyMasterRecord[]> {
    return this.readInboundMasters('VENDOR', since);
  }
  getItems(since?: string): Promise<BusyMasterRecord[]> {
    return this.readInboundMasters('ITEM', since);
  }

  // --- writing -------------------------------------------------------------

  /**
   * Write one XML file into the outbox, named for its external reference.
   *
   * Three things make this safe:
   *  - the filename IS the idempotency key, so a resend cannot create a second
   *    file for the same MES event;
   *  - an existing file (or an existing ack) short-circuits to DUPLICATE
   *    instead of overwriting;
   *  - the write is atomic (temp file + rename), so BUSY can never import a
   *    half-written voucher it happened to catch mid-write.
   */
  private async dropFile(externalReference: string, xml: string): Promise<BusyResult> {
    assertSafeReference(externalReference);
    try {
      await fs.mkdir(this.opts.outbox, { recursive: true });

      const existing = await this.getTransactionStatus(externalReference);
      if (existing.status !== 'UNKNOWN') {
        return {
          ...existing,
          status: existing.status === 'ACCEPTED' || existing.status === 'POSTED' ? 'DUPLICATE' : existing.status,
          message: `External reference ${externalReference} has already been handed to BUSY.`,
        };
      }

      const target = path.join(this.opts.outbox, `${externalReference}.xml`);
      const temp = path.join(this.opts.outbox, `.${externalReference}.tmp`);
      await fs.writeFile(temp, xml, 'utf8');
      await fs.rename(temp, target);

      return {
        status: 'ACCEPTED',
        message: `Written to the BUSY import folder as ${externalReference}.xml. Awaiting BUSY import.`,
        raw: target,
      };
    } catch (err) {
      throw classifyError(err);
    }
  }

  createOrUpdateCustomer(c: MesCustomer, ctx: SendContext): Promise<BusyResult> {
    return this.dropFile(ctx.externalReference, customerToXml(c, ctx, this.opts.companyName));
  }
  createOrUpdateVendor(v: MesVendor, ctx: SendContext): Promise<BusyResult> {
    return this.dropFile(ctx.externalReference, vendorToXml(v, ctx, this.opts.companyName));
  }
  createOrUpdateItem(i: MesItem, ctx: SendContext): Promise<BusyResult> {
    return this.dropFile(ctx.externalReference, itemToXml(i, ctx, this.opts.companyName));
  }
  sendSalesReference(d: MesSalesReference, ctx: SendContext): Promise<BusyResult> {
    return this.dropFile(ctx.externalReference, salesReferenceToXml(d, ctx, this.opts.companyName));
  }
  sendPurchaseReference(d: MesPurchaseReference, ctx: SendContext): Promise<BusyResult> {
    return this.dropFile(ctx.externalReference, purchaseReferenceToXml(d, ctx, this.opts.companyName));
  }
  sendDispatch(d: MesDispatch, ctx: SendContext): Promise<BusyResult> {
    return this.dropFile(ctx.externalReference, dispatchToXml(d, ctx, this.opts.companyName));
  }
  sendInvoice(d: MesInvoice, ctx: SendContext): Promise<BusyResult> {
    return this.dropFile(ctx.externalReference, invoiceToXml(d, ctx, this.opts.companyName));
  }

  // --- status / reconcile --------------------------------------------------

  private async readAck(externalReference: string): Promise<string | null> {
    const ackPath = path.join(this.opts.ack, `${externalReference}.ack.xml`);
    try {
      return await fs.readFile(ackPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw classifyError(err);
    }
  }

  async getTransactionStatus(externalReference: string): Promise<BusyResult> {
    assertSafeReference(externalReference);
    try {
      const ack = await this.readAck(externalReference);
      if (ack) {
        const status = (tagValue(ack, 'STATUS') ?? '').toUpperCase();
        const busyReference = tagValue(ack, 'BUSYREFERENCE') ?? tagValue(ack, 'VOUCHERID');
        const message = tagValue(ack, 'MESSAGE');
        if (status === 'SUCCESS' || status === 'POSTED' || status === 'IMPORTED') {
          return {
            status: 'POSTED',
            ...(busyReference ? { busyReference } : {}),
            ...(tagValue(ack, 'BUSYCODE') ? { busyCode: tagValue(ack, 'BUSYCODE')! } : {}),
            raw: ack,
            ...(message ? { message } : {}),
          };
        }
        if (status === 'DUPLICATE') {
          return { status: 'DUPLICATE', ...(busyReference ? { busyReference } : {}), raw: ack, ...(message ? { message } : {}) };
        }
        // Anything else in an ack file is a rejection. BUSY told us why; carry
        // that verbatim rather than paraphrasing it.
        return {
          status: 'REJECTED',
          raw: ack,
          message: message ?? `BUSY reported status "${status || 'UNKNOWN'}" for ${externalReference}.`,
        };
      }

      // No ack yet. Is the file still sitting in the outbox awaiting import?
      const outboxPath = path.join(this.opts.outbox, `${externalReference}.xml`);
      try {
        await fs.access(outboxPath);
        return { status: 'ACCEPTED', message: 'Handed to BUSY; not yet imported.' };
      } catch {
        // Neither an ack nor an outbox file. Check the archive: it may have
        // been imported and tidied away by a BUSY-side process.
        const archivePath = path.join(this.opts.archive, `${externalReference}.xml`);
        try {
          await fs.access(archivePath);
          return {
            status: 'ACCEPTED',
            message: 'File was collected by BUSY but no acknowledgement has been written yet.',
          };
        } catch {
          return { status: 'UNKNOWN', message: `BUSY has no record of ${externalReference}.` };
        }
      }
    } catch (err) {
      throw classifyError(err);
    }
  }

  async reconcileTransaction(externalReference: string): Promise<BusyTransactionSnapshot | null> {
    assertSafeReference(externalReference);
    const ack = await this.readAck(externalReference);
    if (!ack) return null;

    const lines = tagBlocks(ack, 'ITEM')
      .map((block) => {
        const busyItemId = tagValue(block, 'ITEMID') ?? tagValue(block, 'ITEMCODE');
        const quantity = tagNumber(block, 'QTY');
        if (!busyItemId || quantity === undefined) return null;
        const amount = tagNumber(block, 'AMOUNT');
        return { busyItemId, quantity, ...(amount !== undefined ? { amount } : {}) };
      })
      .filter((l): l is { busyItemId: string; quantity: number; amount?: number } => l !== null);

    const snapshot: BusyTransactionSnapshot = { externalReference };
    const busyReference = tagValue(ack, 'BUSYREFERENCE') ?? tagValue(ack, 'VOUCHERID');
    if (busyReference) snapshot.busyReference = busyReference;
    const documentNumber = tagValue(ack, 'VOUCHERNO');
    if (documentNumber) snapshot.documentNumber = documentNumber;
    const documentDate = tagValue(ack, 'DATE');
    if (documentDate) snapshot.documentDate = documentDate;
    const partyBusyId = tagValue(ack, 'PARTYID');
    if (partyBusyId) snapshot.partyBusyId = partyBusyId;
    const totalAmount = tagNumber(ack, 'TOTALAMOUNT');
    if (totalAmount !== undefined) snapshot.totalAmount = totalAmount;

    if (lines.length > 0) {
      snapshot.lines = lines;
      snapshot.totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);
    } else {
      const totalQuantity = tagNumber(ack, 'TOTALQTY');
      if (totalQuantity !== undefined) snapshot.totalQuantity = totalQuantity;
    }
    return snapshot;
  }
}
