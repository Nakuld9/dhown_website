import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bridge } from '../../bridge';
import type { EntityType } from '../../config';
import { redactedConfig } from '../../config';
import { BridgeError, classifyError } from '../../errors';
import type { MappingEntityType, MappingSyncStatus } from '../../mapping/mappingStore';
import type { QueueStatus } from '../../queue/queueStore';
import type { ReconResult } from '../../reconcile/reconciler';
import { hasRole, type Principal } from '../auth';
import { methodNotAllowed, notFound, readJsonBody, sendError, sendJson } from '../http';

/**
 * Administrative API behind the dashboard.
 *
 * Read operations need `viewer`. Anything that changes state — retry, fix
 * mapping, reconcile — needs `operator` or better, per the spec's rule that
 * only authorised users may perform manual actions.
 */

function requireRole(principal: Principal, required: 'viewer' | 'operator' | 'admin', res: ServerResponse): boolean {
  if (hasRole(principal, required)) return true;
  sendJson(res, 403, {
    ok: false,
    error: {
      code: 'FORBIDDEN',
      message: `This action requires the "${required}" role; your key has "${principal.role}".`,
    },
  });
  return false;
}

/**
 * Attach the human-readable reason/action to a queue row for the UI.
 *
 * The stored details carry the real subject of the failure, which is often NOT
 * this row's own MES id — an unmapped item on a dispatch, for instance. Falling
 * back to mesEntityId would tell the operator to map the dispatch, which is
 * not a thing they can do.
 */
function explainRow(row: {
  errorCode: string | null;
  errorMessage: string | null;
  errorDetails?: string | null;
  entityType: string;
  mesEntityId: string;
}) {
  if (!row.errorCode) return null;
  let details: Record<string, unknown> = {};
  if (row.errorDetails) {
    try {
      details = JSON.parse(row.errorDetails) as Record<string, unknown>;
    } catch {
      /* a malformed details blob must not hide the error itself */
    }
  }
  if (details.subject === undefined) details.subject = row.mesEntityId;
  const error = new BridgeError(row.errorCode as any, row.errorMessage ?? '', details);
  return error.explain();
}

export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  bridge: Bridge,
  principal: Principal,
): Promise<void> {
  const rest = url.pathname.split('/').filter(Boolean).slice(3); // after /api/v1/admin
  const head = rest[0] ?? '';

  // --- GET /api/v1/admin/overview -----------------------------------------
  if (head === 'overview' && req.method === 'GET') {
    if (!requireRole(principal, 'viewer', res)) return;
    const connection = bridge.worker.connectionState();
    sendJson(res, 200, {
      ok: true,
      connection: {
        ...connection,
        adapter: bridge.adapter.name,
        capabilities: bridge.adapter.capabilities(),
      },
      queue: bridge.queue.counts(),
      mappings: bridge.mappings.counts(),
      reconciliation: bridge.reconciler.summary(),
      todaysTransactions: bridge.queue.countToday(),
      lastSuccessfulSync: bridge.queue.lastSuccessAt(),
      config: redactedConfig(bridge.config),
    });
    return;
  }

  // --- GET /api/v1/admin/connection/test ----------------------------------
  if (head === 'connection' && rest[1] === 'test' && req.method === 'POST') {
    if (!requireRole(principal, 'operator', res)) return;
    try {
      const status = await bridge.adapter.testConnection();
      sendJson(res, 200, { ok: true, ...status });
    } catch (err) {
      sendError(res, 502, err);
    }
    return;
  }

  // --- Queue ---------------------------------------------------------------
  if (head === 'queue') {
    // GET /api/v1/admin/queue
    if (rest.length === 1 && req.method === 'GET') {
      if (!requireRole(principal, 'viewer', res)) return;
      const status = url.searchParams.get('status') as QueueStatus | null;
      const entityType = url.searchParams.get('entityType') as EntityType | null;
      const search = url.searchParams.get('search');
      const items = bridge.queue.list({
        ...(status ? { status } : {}),
        ...(entityType ? { entityType } : {}),
        ...(search ? { search } : {}),
        limit: Math.min(Number(url.searchParams.get('limit') ?? 50), 200),
        offset: Number(url.searchParams.get('offset') ?? 0),
      });
      sendJson(res, 200, {
        ok: true,
        items: items.map((i) => ({ ...i, payload: undefined, explanation: explainRow(i) })),
      });
      return;
    }

    const id = Number(rest[1]);
    if (!Number.isInteger(id)) {
      notFound(res, 'Queue item');
      return;
    }

    // GET /api/v1/admin/queue/:id — including the payload ("View Payload")
    if (rest.length === 2 && req.method === 'GET') {
      if (!requireRole(principal, 'viewer', res)) return;
      const item = bridge.queue.findById(id);
      if (!item) {
        notFound(res, 'Queue item');
        return;
      }
      let payload: unknown = item.payload;
      try {
        payload = JSON.parse(item.payload);
      } catch {
        /* keep the raw string if it is not JSON */
      }
      sendJson(res, 200, {
        ok: true,
        item: { ...item, payload },
        explanation: explainRow(item),
        audit: bridge.audit.forQueueItem(id),
      });
      return;
    }

    // POST /api/v1/admin/queue/:id/retry — "Retry"
    if (rest[2] === 'retry' && req.method === 'POST') {
      if (!requireRole(principal, 'operator', res)) return;
      const item = bridge.queue.requeueForManualRetry(id);
      if (!item) {
        notFound(res, 'Queue item');
        return;
      }
      if (item.status === 'SUCCESS') {
        // Never resend something BUSY already booked.
        sendJson(res, 409, {
          ok: false,
          error: {
            code: 'DUPLICATE_ERROR',
            message: 'This transaction is already successful in BUSY and will not be resent.',
            action: 'Use Reconcile if you believe BUSY and MES disagree.',
          },
        });
        return;
      }
      bridge.audit.record({
        queueId: id,
        entityType: item.entityType,
        mesEntityId: item.mesEntityId,
        externalReference: item.externalReference,
        operation: item.operation,
        attemptCount: item.attemptCount,
        actor: principal.label,
        finalStatus: 'MANUAL_RETRY_REQUESTED',
      });
      try {
        const outcome = await bridge.processOne(id, principal.label);
        sendJson(res, 200, { ok: true, outcome });
      } catch (err) {
        sendError(res, 502, err);
      }
      return;
    }

    // POST /api/v1/admin/queue/:id/reconcile — "Reconcile"
    if (rest[2] === 'reconcile' && req.method === 'POST') {
      if (!requireRole(principal, 'operator', res)) return;
      const item = bridge.queue.findById(id);
      if (!item) {
        notFound(res, 'Queue item');
        return;
      }
      try {
        const row = await bridge.reconciler.reconcileItem(`manual-${Date.now()}`, item);
        sendJson(res, 200, { ok: true, reconciliation: row });
      } catch (err) {
        sendError(res, 502, err);
      }
      return;
    }

    // GET /api/v1/admin/queue/:id/busy-reference — "View BUSY Reference"
    if (rest[2] === 'busy-reference' && req.method === 'GET') {
      if (!requireRole(principal, 'viewer', res)) return;
      const item = bridge.queue.findById(id);
      if (!item) {
        notFound(res, 'Queue item');
        return;
      }
      try {
        const live = bridge.adapter.capabilities().getTransactionStatus
          ? await bridge.adapter.getTransactionStatus(item.externalReference)
          : null;
        sendJson(res, 200, {
          ok: true,
          externalReference: item.externalReference,
          storedBusyReference: item.busyReference,
          live,
        });
      } catch (err) {
        sendError(res, 502, err);
      }
      return;
    }

    methodNotAllowed(res);
    return;
  }

  // --- Mappings ------------------------------------------------------------
  if (head === 'mappings') {
    // GET /api/v1/admin/mappings
    if (rest.length === 1 && req.method === 'GET') {
      if (!requireRole(principal, 'viewer', res)) return;
      const entityType = url.searchParams.get('entityType') as MappingEntityType | null;
      const syncStatus = url.searchParams.get('syncStatus') as MappingSyncStatus | null;
      const search = url.searchParams.get('search');
      sendJson(res, 200, {
        ok: true,
        items: bridge.mappings.list({
          ...(entityType ? { entityType } : {}),
          ...(syncStatus ? { syncStatus } : {}),
          ...(search ? { search } : {}),
          limit: Math.min(Number(url.searchParams.get('limit') ?? 200), 500),
        }),
      });
      return;
    }

    // GET /api/v1/admin/mappings/unmapped — the operator's to-do list
    if (rest[1] === 'unmapped' && req.method === 'GET') {
      if (!requireRole(principal, 'viewer', res)) return;
      const entityType = url.searchParams.get('entityType') as MappingEntityType | null;
      sendJson(res, 200, { ok: true, items: bridge.mappings.unmapped(entityType ?? undefined) });
      return;
    }

    // POST /api/v1/admin/mappings — "Fix Mapping"
    if (rest.length === 1 && req.method === 'POST') {
      if (!requireRole(principal, 'operator', res)) return;
      try {
        const body = await readJsonBody<{
          entityType: MappingEntityType;
          mesId: string;
          busyId: string;
          busyCode?: string;
        }>(req);
        if (!body.entityType || !body.mesId || !body.busyId) {
          throw new BridgeError('VALIDATION_ERROR', 'entityType, mesId and busyId are required.');
        }
        const mapping = bridge.mappings.setManualMapping(
          body.entityType,
          body.mesId,
          body.busyId,
          body.busyCode,
        );
        bridge.audit.record({
          entityType: body.entityType,
          mesEntityId: body.mesId,
          operation: 'FIX_MAPPING',
          actor: principal.label,
          busyReference: body.busyId,
          finalStatus: 'MAPPING_SET',
        });
        sendJson(res, 200, { ok: true, mapping });
      } catch (err) {
        const status = err instanceof BridgeError ? 422 : 409;
        sendError(res, status, classifyError(err));
      }
      return;
    }

    // DELETE /api/v1/admin/mappings/:entityType/:mesId — unmap a mistake
    if (req.method === 'DELETE' && rest[1] && rest[2]) {
      if (!requireRole(principal, 'admin', res)) return;
      const entityType = rest[1].toUpperCase() as MappingEntityType;
      const mesId = decodeURIComponent(rest[2]);
      bridge.mappings.clearMapping(entityType, mesId);
      bridge.audit.record({
        entityType,
        mesEntityId: mesId,
        operation: 'CLEAR_MAPPING',
        actor: principal.label,
        finalStatus: 'MAPPING_CLEARED',
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    methodNotAllowed(res);
    return;
  }

  // --- Reconciliation ------------------------------------------------------
  if (head === 'reconciliation') {
    if (rest.length === 1 && req.method === 'GET') {
      if (!requireRole(principal, 'viewer', res)) return;
      const result = url.searchParams.get('result') as ReconResult | null;
      sendJson(res, 200, {
        ok: true,
        summary: bridge.reconciler.summary(),
        items: bridge.reconciler.list({
          ...(result ? { result } : {}),
          resolved: url.searchParams.get('resolved') === 'true',
          limit: Math.min(Number(url.searchParams.get('limit') ?? 100), 500),
        }),
      });
      return;
    }

    // POST /api/v1/admin/reconciliation/run
    if (rest[1] === 'run' && req.method === 'POST') {
      if (!requireRole(principal, 'operator', res)) return;
      try {
        const summary = await bridge.reconciler.run(bridge.config.reconcile.lookbackDays);
        sendJson(res, 200, { ok: true, summary });
      } catch (err) {
        sendError(res, 502, err);
      }
      return;
    }

    // POST /api/v1/admin/reconciliation/:id/resolve
    if (rest[2] === 'resolve' && req.method === 'POST') {
      if (!requireRole(principal, 'operator', res)) return;
      const id = Number(rest[1]);
      if (!Number.isInteger(id)) {
        notFound(res, 'Reconciliation row');
        return;
      }
      bridge.reconciler.markResolved(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    methodNotAllowed(res);
    return;
  }

  // --- Audit ---------------------------------------------------------------
  if (head === 'audit' && req.method === 'GET') {
    if (!requireRole(principal, 'viewer', res)) return;
    const ref = url.searchParams.get('externalReference');
    sendJson(res, 200, {
      ok: true,
      entries: ref
        ? bridge.audit.forExternalReference(ref)
        : bridge.audit.recent(Math.min(Number(url.searchParams.get('limit') ?? 100), 500)),
    });
    return;
  }

  // --- Worker control ------------------------------------------------------
  if (head === 'worker' && rest[1] === 'tick' && req.method === 'POST') {
    if (!requireRole(principal, 'operator', res)) return;
    const result = await bridge.worker.tick();
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  notFound(res);
}
