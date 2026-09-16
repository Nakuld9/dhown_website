import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bridge } from '../../bridge';
import type { EntityType } from '../../config';
import { ALL_ENTITY_TYPES } from '../../config';
import { BridgeError } from '../../errors';
import type { Principal } from '../auth';
import { notFound, readJsonBody, sendError, sendJson } from '../http';

/**
 * The MES-facing internal API.
 *
 * MES posts commercial records here and gets an immediate acknowledgement.
 * It never waits for BUSY, and it never learns anything about BUSY's
 * transport — which is what makes the adapter swappable.
 *
 * This API is for MES only. It is not, and must never become, a customer
 * portal endpoint.
 */

const ROUTE_TO_ENTITY: Record<string, EntityType> = {
  customers: 'CUSTOMER',
  vendors: 'VENDOR',
  items: 'ITEM',
  warehouses: 'WAREHOUSE',
  'sales-references': 'SALES_REFERENCE',
  'purchase-references': 'PURCHASE_REFERENCE',
  dispatches: 'DISPATCH',
  invoices: 'INVOICE',
};

export async function handleInternal(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  bridge: Bridge,
  principal: Principal,
): Promise<void> {
  const segments = url.pathname.split('/').filter(Boolean); // ['api','v1','mes', ...]
  const rest = segments.slice(3);

  // POST /api/v1/mes/<entity>
  if (req.method === 'POST' && rest.length === 1 && rest[0] && ROUTE_TO_ENTITY[rest[0]]) {
    const entityType = ROUTE_TO_ENTITY[rest[0]]!;
    try {
      const payload = await readJsonBody<Record<string, unknown>>(req);
      const result = bridge.submit({
        entityType,
        payload,
        createdBy: principal.kind === 'mes' ? 'MES' : principal.label,
      });
      // 202: we have taken responsibility for it, BUSY has not seen it yet.
      sendJson(res, result.created ? 202 : 200, { ok: true, ...result });
    } catch (err) {
      const status = err instanceof BridgeError && err.code === 'VALIDATION_ERROR' ? 422 : 400;
      sendError(res, status, err);
    }
    return;
  }

  // GET /api/v1/mes/status/<externalReference>
  // How MES learns the BUSY reference for a dispatch it submitted earlier.
  if (req.method === 'GET' && rest[0] === 'status' && rest[1]) {
    const externalReference = decodeURIComponent(rest[1]);
    const item = bridge.queue.findByExternalReference(externalReference);
    if (!item) {
      notFound(res, `External reference ${externalReference}`);
      return;
    }
    sendJson(res, 200, {
      ok: true,
      externalReference: item.externalReference,
      entityType: item.entityType,
      mesEntityId: item.mesEntityId,
      status: item.status,
      busyReference: item.busyReference,
      attemptCount: item.attemptCount,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      updatedAt: item.updatedAt,
    });
    return;
  }

  // GET /api/v1/mes/entity/<entityType>/<mesId> — status by MES identity.
  if (req.method === 'GET' && rest[0] === 'entity' && rest[1] && rest[2]) {
    const entityType = rest[1].toUpperCase() as EntityType;
    if (!ALL_ENTITY_TYPES.includes(entityType)) {
      notFound(res, `Entity type ${rest[1]}`);
      return;
    }
    const items = bridge.queue.list({ entityType, search: decodeURIComponent(rest[2]), limit: 20 });
    sendJson(res, 200, {
      ok: true,
      items: items.map((i) => ({
        externalReference: i.externalReference,
        status: i.status,
        busyReference: i.busyReference,
        updatedAt: i.updatedAt,
      })),
    });
    return;
  }

  // GET /api/v1/mes/masters/<type> — BUSY -> MES master sync.
  // Returns what BUSY holds so MES can align its own master list. The bridge
  // does not push these into MES: MES decides what to do with them.
  if (req.method === 'GET' && rest[0] === 'masters' && rest[1]) {
    const kind = rest[1].toLowerCase();
    const caps = bridge.adapter.capabilities();
    try {
      const since = url.searchParams.get('since') ?? undefined;
      if (kind === 'customers' && caps.getCustomers) {
        sendJson(res, 200, { ok: true, data: await bridge.adapter.getCustomers(since) });
        return;
      }
      if (kind === 'vendors' && caps.getVendors) {
        sendJson(res, 200, { ok: true, data: await bridge.adapter.getVendors(since) });
        return;
      }
      if (kind === 'items' && caps.getItems) {
        sendJson(res, 200, { ok: true, data: await bridge.adapter.getItems(since) });
        return;
      }
      sendJson(res, 501, {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: `This BUSY installation cannot serve "${kind}" masters.`,
          reason: `The configured "${bridge.adapter.name}" adapter does not support reading ${kind} from BUSY.`,
          action: 'See docs/BUSY_INTEGRATION.md for the capability matrix.',
        },
      });
    } catch (err) {
      sendError(res, 502, err);
    }
    return;
  }

  notFound(res);
}
