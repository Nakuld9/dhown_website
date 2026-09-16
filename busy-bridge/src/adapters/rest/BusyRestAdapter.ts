import { BridgeError, classifyError, UnsupportedOperationError } from '../../errors';
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

export interface RestAdapterOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /**
   * Read-only deployments (e.g. a gateway sitting on the BUSY SQL database).
   *
   * Per the audit decision in docs/BUSY_INTEGRATION.md: direct writes to BUSY's
   * database bypass its posting, numbering, GST and stock-valuation logic and
   * can silently corrupt a statutory system. When this is set, every write
   * throws UnsupportedOperationError — the rule is enforced in code, not left
   * to whoever configures the gateway.
   */
  readOnly?: boolean;
}

interface GatewayResponse {
  status?: string;
  reference?: string;
  busyReference?: string;
  code?: string;
  busyCode?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Adapter for a third-party / in-house REST gateway in front of BUSY.
 *
 * BUSY has no native public REST API (see the audit). This adapter is for
 * installations where the customer has licensed or built a gateway, and is
 * strictly opt-in via BUSY_ADAPTER=rest.
 */
export class BusyRestAdapter implements BusyAdapter {
  readonly name = 'rest';
  private readonly baseUrl: string;

  constructor(private readonly opts: RestAdapterOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  }

  capabilities(): AdapterCapabilities {
    const writable = !this.opts.readOnly;
    return {
      testConnection: true,
      getCustomers: true,
      getVendors: true,
      getItems: true,
      createOrUpdateCustomer: writable,
      createOrUpdateVendor: writable,
      createOrUpdateItem: writable,
      sendSalesReference: writable,
      sendPurchaseReference: writable,
      sendDispatch: writable,
      sendInvoice: writable,
      getTransactionStatus: true,
      reconcileTransaction: true,
      // A gateway answers synchronously, so a send can return a real BUSY
      // reference immediately instead of parking in AWAITING_BUSY.
      synchronousSend: writable,
    };
  }

  private assertWritable(operation: string): void {
    if (this.opts.readOnly) {
      throw new UnsupportedOperationError(`${operation} (gateway is configured read-only)`, this.name);
    }
  }

  private async request<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${route}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          // Credentials come from the environment and are never echoed back to
          // any caller of this service.
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      const text = await response.text();

      if (response.status === 401 || response.status === 403) {
        throw new BridgeError('AUTHENTICATION_ERROR', `BUSY gateway rejected our credentials (HTTP ${response.status}).`, {
          action: 'CHECK_CREDENTIALS',
          busyResponse: text.slice(0, 2000),
        });
      }
      if (response.status === 409) {
        throw new BridgeError('DUPLICATE_ERROR', 'BUSY already holds this external reference.', {
          action: 'RECONCILE',
          busyResponse: text.slice(0, 2000),
        });
      }
      if (response.status === 408 || response.status === 504) {
        throw new BridgeError('TIMEOUT', `BUSY gateway timed out (HTTP ${response.status}).`, {
          busyResponse: text.slice(0, 2000),
        });
      }
      if (response.status >= 500) {
        // Server-side faults are transport problems from our side: retryable.
        throw new BridgeError('CONNECTION_ERROR', `BUSY gateway returned HTTP ${response.status}.`, {
          action: 'CHECK_CONNECTION',
          busyResponse: text.slice(0, 2000),
        });
      }
      if (response.status >= 400) {
        // 4xx that is not auth/conflict/timeout means BUSY refused the
        // transaction on business grounds. Not retryable.
        throw new BridgeError('BUSY_TRANSACTION_ERROR', `BUSY rejected the transaction (HTTP ${response.status}).`, {
          busyResponse: text.slice(0, 2000),
        });
      }

      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new BridgeError('UNKNOWN_ERROR', 'BUSY gateway returned a response that was not valid JSON.', {
          busyResponse: text.slice(0, 2000),
        });
      }
    } catch (err) {
      throw classifyError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<ConnectionStatus> {
    try {
      const info = await this.request<Record<string, unknown>>('GET', '/health');
      return { online: true, message: 'BUSY gateway reachable.', detail: info };
    } catch (err) {
      const be = classifyError(err);
      return { online: false, message: be.message, detail: { code: be.code } };
    }
  }

  private toResult(res: GatewayResponse): BusyResult {
    const raw = JSON.stringify(res);
    const reference = res.busyReference ?? res.reference;
    const code = res.busyCode ?? res.code;
    const declared = (res.status ?? '').toUpperCase();
    const status: BusyResult['status'] =
      declared === 'DUPLICATE'
        ? 'DUPLICATE'
        : declared === 'REJECTED' || declared === 'FAILED'
          ? 'REJECTED'
          : declared === 'PENDING' || declared === 'ACCEPTED'
            ? 'ACCEPTED'
            : reference
              ? 'POSTED'
              : 'ACCEPTED';
    return {
      status,
      ...(reference ? { busyReference: reference } : {}),
      ...(code ? { busyCode: code } : {}),
      ...(res.message ? { message: res.message } : {}),
      raw,
    };
  }

  private async fetchMasters(route: string, since?: string): Promise<BusyMasterRecord[]> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const body = await this.request<{ data?: unknown[] }>('GET', `${route}${query}`);
    const rows = Array.isArray(body.data) ? body.data : [];
    return rows
      .map((row) => {
        const r = row as Record<string, unknown>;
        const busyId = r.busyId ?? r.id ?? r.code;
        const name = r.name;
        if (typeof busyId !== 'string' && typeof busyId !== 'number') return null;
        if (typeof name !== 'string') return null;
        const record: BusyMasterRecord = { busyId: String(busyId), name, raw: r };
        if (typeof r.code === 'string') record.busyCode = r.code;
        if (typeof r.gstin === 'string') record.gstin = r.gstin;
        return record;
      })
      .filter((r): r is BusyMasterRecord => r !== null);
  }

  getCustomers(since?: string) {
    return this.fetchMasters('/customers', since);
  }
  getVendors(since?: string) {
    return this.fetchMasters('/vendors', since);
  }
  getItems(since?: string) {
    return this.fetchMasters('/items', since);
  }

  private async post(route: string, operation: string, payload: unknown, ctx: SendContext): Promise<BusyResult> {
    this.assertWritable(operation);
    const res = await this.request<GatewayResponse>('POST', route, {
      // The gateway is expected to treat this as its own idempotency key.
      externalReference: ctx.externalReference,
      partyBusyId: ctx.partyBusyId,
      partyBusyCode: ctx.partyBusyCode,
      warehouseBusyId: ctx.warehouseBusyId,
      itemBusyIds: ctx.itemBusyIds,
      attempt: ctx.attempt,
      payload,
    });
    return this.toResult(res);
  }

  createOrUpdateCustomer(c: MesCustomer, ctx: SendContext) {
    return this.post('/customers', 'createOrUpdateCustomer', c, ctx);
  }
  createOrUpdateVendor(v: MesVendor, ctx: SendContext) {
    return this.post('/vendors', 'createOrUpdateVendor', v, ctx);
  }
  createOrUpdateItem(i: MesItem, ctx: SendContext) {
    return this.post('/items', 'createOrUpdateItem', i, ctx);
  }
  sendSalesReference(d: MesSalesReference, ctx: SendContext) {
    return this.post('/sales-references', 'sendSalesReference', d, ctx);
  }
  sendPurchaseReference(d: MesPurchaseReference, ctx: SendContext) {
    return this.post('/purchase-references', 'sendPurchaseReference', d, ctx);
  }
  sendDispatch(d: MesDispatch, ctx: SendContext) {
    return this.post('/dispatches', 'sendDispatch', d, ctx);
  }
  sendInvoice(d: MesInvoice, ctx: SendContext) {
    return this.post('/invoices', 'sendInvoice', d, ctx);
  }

  async getTransactionStatus(externalReference: string): Promise<BusyResult> {
    try {
      const res = await this.request<GatewayResponse>(
        'GET',
        `/transactions/${encodeURIComponent(externalReference)}`,
      );
      return this.toResult(res);
    } catch (err) {
      const be = classifyError(err);
      // "BUSY has never seen this" is an answer, not a failure — and it is the
      // answer idempotency recovery depends on after a crash.
      if (be.code === 'BUSY_TRANSACTION_ERROR' && /404|not found/i.test(String(be.details.busyResponse ?? be.message))) {
        return { status: 'UNKNOWN', message: `BUSY has no record of ${externalReference}.` };
      }
      throw be;
    }
  }

  async reconcileTransaction(externalReference: string): Promise<BusyTransactionSnapshot | null> {
    const res = await this.request<Record<string, unknown>>(
      'GET',
      `/transactions/${encodeURIComponent(externalReference)}/detail`,
    );
    if (!res || Object.keys(res).length === 0) return null;
    const snapshot: BusyTransactionSnapshot = { externalReference, raw: res };
    if (typeof res.busyReference === 'string') snapshot.busyReference = res.busyReference;
    if (typeof res.documentNumber === 'string') snapshot.documentNumber = res.documentNumber;
    if (typeof res.documentDate === 'string') snapshot.documentDate = res.documentDate;
    if (typeof res.partyBusyId === 'string') snapshot.partyBusyId = res.partyBusyId;
    if (typeof res.totalQuantity === 'number') snapshot.totalQuantity = res.totalQuantity;
    if (typeof res.totalAmount === 'number') snapshot.totalAmount = res.totalAmount;
    if (Array.isArray(res.lines)) {
      snapshot.lines = (res.lines as Array<Record<string, unknown>>)
        .map((l) => {
          const busyItemId = l.busyItemId ?? l.itemId;
          if (typeof busyItemId !== 'string' || typeof l.quantity !== 'number') return null;
          return {
            busyItemId,
            quantity: l.quantity,
            ...(typeof l.amount === 'number' ? { amount: l.amount } : {}),
          };
        })
        .filter((l): l is { busyItemId: string; quantity: number; amount?: number } => l !== null);
    }
    return snapshot;
  }
}
