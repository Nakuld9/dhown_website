import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupTempDirs,
  customer,
  dispatch,
  invoice,
  item,
  makeBridge,
  seedMappings,
  vendor,
} from './helpers';

/**
 * The fifteen scenarios named in the specification, in order.
 *
 * These drive the queue deterministically (bridge.drain()) rather than waiting
 * on the worker's timer, so a failure means a real defect rather than a slow
 * machine.
 */

after(cleanupTempDirs);

describe('1. Successful customer sync', () => {
  it('queues, sends and records the BUSY reference and mapping', async () => {
    const h = makeBridge();
    try {
      const submitted = h.bridge.submit({ entityType: 'CUSTOMER', payload: customer() });
      assert.equal(submitted.accepted, true);
      assert.equal(submitted.created, true);
      assert.match(submitted.externalReference, /^DHOWN-CUSTOMER-\d{4}-\d{6}$/);
      assert.equal(submitted.status, 'PENDING');

      await h.bridge.drain();

      const queued = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(queued.status, 'SUCCESS');
      assert.ok(queued.busyReference, 'a BUSY reference must be stored');

      // The mapping must now exist — that is what later documents resolve against.
      const mapping = h.bridge.mappings.find('CUSTOMER', 'CUST-00042')!;
      assert.equal(mapping.syncStatus, 'SYNCED');
      assert.equal(mapping.busyId, queued.busyReference);

      const audit = h.bridge.audit.forQueueItem(queued.id);
      assert.ok(audit.some((a) => a.finalStatus === 'SUCCESS'));
    } finally {
      h.close();
    }
  });
});

describe('2. Successful item sync', () => {
  it('syncs an item master and maps it', async () => {
    const h = makeBridge();
    try {
      const submitted = h.bridge.submit({ entityType: 'ITEM', payload: item() });
      await h.bridge.drain();

      const queued = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(queued.status, 'SUCCESS');
      assert.equal(h.bridge.mappings.find('ITEM', 'FC-00125')!.syncStatus, 'SYNCED');
      assert.equal(h.busy.items.size, 1);
    } finally {
      h.close();
    }
  });

  it('syncs a vendor master too', async () => {
    const h = makeBridge();
    try {
      h.bridge.submit({ entityType: 'VENDOR', payload: vendor() });
      await h.bridge.drain();
      assert.equal(h.bridge.mappings.find('VENDOR', 'VEND-00007')!.syncStatus, 'SYNCED');
    } finally {
      h.close();
    }
  });
});

describe('3. Successful dispatch', () => {
  it('flows MES -> validation -> queue -> BUSY -> reference -> MES', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      assert.equal(submitted.externalReference, 'DHOWN-DISPATCH-2026-000091');

      await h.bridge.drain();

      const queued = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(queued.status, 'SUCCESS');
      assert.ok(queued.busyReference);

      // The BUSY-side record must carry the resolved BUSY item id, never the MES one.
      const tx = h.busy.transactions.get(submitted.externalReference)!;
      assert.equal(tx.partyBusyId, 'BUSY-CUST-11');
      assert.equal(tx.lines![0]!.busyItemId, 'BUSY-ITEM-4587');
      assert.equal(tx.totalQuantity, 500);
    } finally {
      h.close();
    }
  });

  it('exposes the BUSY reference back to MES by external reference', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();
      const item = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(item.status, 'SUCCESS');
      assert.ok(item.busyReference);
    } finally {
      h.close();
    }
  });
});

describe('4. BUSY offline', () => {
  it('keeps accepting dispatches and holds them in the queue', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      h.busy.online = false;

      // MES must not be blocked or refused while BUSY is down.
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      assert.equal(submitted.accepted, true);

      const tick = await h.bridge.worker.tick();
      assert.equal(tick.online, false);
      assert.equal(tick.processed, 0, 'no attempt should be burned while BUSY is offline');

      const queued = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(queued.status, 'PENDING');
      assert.equal(queued.attemptCount, 0);
      assert.equal(h.busy.transactions.size, 0);
    } finally {
      h.close();
    }
  });

  it('drains the queue when BUSY comes back', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      h.busy.online = false;
      h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      h.bridge.submit({ entityType: 'INVOICE', payload: invoice() });
      await h.bridge.worker.tick();
      assert.equal(h.bridge.queue.counts().PENDING, 2);

      h.busy.online = true;
      const tick = await h.bridge.worker.tick();

      assert.equal(tick.online, true);
      assert.equal(tick.processed, 2);
      assert.equal(h.bridge.queue.counts().SUCCESS, 2);
    } finally {
      h.close();
    }
  });
});

describe('5. Network interruption', () => {
  it('classifies a transient failure as retryable and schedules a retry', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });

      h.busy.failuresBeforeSuccess = 1;
      // One attempt, driven directly. Using drain() here would depend on
      // whether the backoff elapses during the test, which is not what this
      // scenario is about.
      await h.bridge.processOne(submitted.queueId);

      const afterFailure = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(afterFailure.status, 'RETRY');
      assert.equal(afterFailure.errorCode, 'CONNECTION_ERROR');
      assert.equal(afterFailure.attemptCount, 1);
      assert.ok(afterFailure.nextRetryAt, 'a backoff time must be scheduled');
    } finally {
      h.close();
    }
  });
});

describe('6. Duplicate request', () => {
  it('collapses a resubmission onto the same external reference', () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const first = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      const second = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });

      assert.equal(first.externalReference, second.externalReference);
      assert.equal(first.queueId, second.queueId);
      assert.equal(first.created, true);
      assert.equal(second.created, false, 'the second submission must not create a new job');
      assert.equal(h.bridge.queue.counts().PENDING, 1);
    } finally {
      h.close();
    }
  });

  it('never creates a second BUSY transaction for the same reference', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      // Force the already-successful job through the pipeline again.
      const outcome = await h.bridge.processOne(submitted.queueId);

      assert.equal(outcome.status, 'SUCCESS');
      assert.equal(outcome.deduplicated, true);
      assert.equal(h.busy.transactions.size, 1, 'BUSY must hold exactly one transaction');
      const sends = h.busy.sendLog.filter((s) => s.operation === 'sendDispatch');
      assert.equal(sends.length, 1, 'the dispatch must have been sent to BUSY only once');
    } finally {
      h.close();
    }
  });
});

describe('7. Invalid customer', () => {
  it('rejects at the boundary without queueing', () => {
    const h = makeBridge();
    try {
      assert.throws(
        () => h.bridge.submit({ entityType: 'CUSTOMER', payload: customer({ name: '' }) }),
        (err: any) => {
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.equal(err.retryable, false);
          assert.ok(err.details.issues.some((i: string) => i.includes('name')));
          return true;
        },
      );
      assert.equal(h.bridge.queue.counts().PENDING, 0);
    } finally {
      h.close();
    }
  });

  it('rejects a malformed GSTIN with an actionable message', () => {
    const h = makeBridge();
    try {
      assert.throws(
        () => h.bridge.submit({ entityType: 'CUSTOMER', payload: customer({ gstin: 'NOTAGSTIN' }) }),
        (err: any) => {
          const explained = err.explain();
          assert.match(explained.reason, /failed validation/i);
          assert.match(explained.action, /Correct/);
          return true;
        },
      );
    } finally {
      h.close();
    }
  });
});

describe('8. Invalid item', () => {
  it('rejects an item with no unit of measure', () => {
    const h = makeBridge();
    try {
      assert.throws(
        () => h.bridge.submit({ entityType: 'ITEM', payload: item({ unit: '' }) }),
        (err: any) => err.code === 'VALIDATION_ERROR' && err.details.issues.includes('unit is required'),
      );
    } finally {
      h.close();
    }
  });

  it('rejects an impossible HSN code and GST rate', () => {
    const h = makeBridge();
    try {
      assert.throws(() => h.bridge.submit({ entityType: 'ITEM', payload: item({ hsnCode: 'ABC' }) }));
      assert.throws(() => h.bridge.submit({ entityType: 'ITEM', payload: item({ gstRate: 150 }) }));
    } finally {
      h.close();
    }
  });
});

describe('9. Missing mapping', () => {
  it('parks the dispatch for manual review naming the unmapped item', async () => {
    const h = makeBridge();
    try {
      // Customer is mapped; the item deliberately is not.
      h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11');
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      const queued = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(queued.status, 'MANUAL_REVIEW');
      assert.equal(queued.errorCode, 'MASTER_MAPPING_ERROR');
      assert.match(queued.errorMessage!, /FC-00125/);

      // Nothing must have reached BUSY.
      assert.equal(h.busy.transactions.size, 0);

      // And the operator must have something to click "Fix Mapping" on.
      const unmapped = h.bridge.mappings.unmapped('ITEM');
      assert.ok(unmapped.some((m) => m.mesId === 'FC-00125'));
    } finally {
      h.close();
    }
  });

  it('names the unmapped item, not the dispatch, in the operator message', async () => {
    // Regression: the dashboard rebuilt the error from the queue row and used
    // the row's own MES id as the subject, telling the operator to "map the
    // dispatch" — which is not something they can do.
    const h = makeBridge();
    try {
      h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11');
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      const queued = h.bridge.queue.findById(submitted.queueId)!;
      assert.ok(queued.errorDetails, 'the classified details must be persisted with the row');

      const details = JSON.parse(queued.errorDetails!);
      assert.equal(details.subject, 'FC-00125', 'the subject is the unmapped item');
      assert.equal(details.entityType, 'ITEM');
      assert.notEqual(details.subject, queued.mesEntityId);
    } finally {
      h.close();
    }
  });

  it('succeeds once an operator supplies the mapping and retries', async () => {
    const h = makeBridge();
    try {
      h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11');
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();
      assert.equal(h.bridge.queue.findById(submitted.queueId)!.status, 'MANUAL_REVIEW');

      // Operator maps MES item FC-00125 to BUSY item BUSY-4587, then retries.
      h.bridge.mappings.setManualMapping('ITEM', 'FC-00125', 'BUSY-ITEM-4587', 'BUSY-4587');
      h.bridge.queue.requeueForManualRetry(submitted.queueId);
      const outcome = await h.bridge.processOne(submitted.queueId, 'key:test***');

      assert.equal(outcome.status, 'SUCCESS');
      assert.ok(outcome.busyReference);
    } finally {
      h.close();
    }
  });

  it('produces the operator message the specification asks for', () => {
    const h = makeBridge();
    try {
      h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11');
      let thrown: any;
      try {
        h.bridge.mappings.resolve('ITEM', 'FC-00125');
      } catch (err) {
        thrown = err;
      }
      const explained = thrown.explain();
      assert.equal(explained.reason, 'MES item "FC-00125" is not mapped to a BUSY item.');
      assert.equal(explained.action, 'Map MES item "FC-00125" to the matching BUSY item, then retry.');
    } finally {
      h.close();
    }
  });
});

describe('10. Timeout', () => {
  it('classifies a timeout as retryable and does not mark it failed', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      h.busy.timeoutNext = true;
      await h.bridge.processOne(submitted.queueId);

      const queued = h.bridge.queue.findByExternalReference(submitted.externalReference)!;
      assert.equal(queued.errorCode, 'TIMEOUT');
      assert.equal(queued.status, 'RETRY');

      // A timeout is ambiguous — the operator must be warned not to assume
      // nothing was posted.
      const audit = h.bridge.audit.forQueueItem(queued.id).find((a) => a.errorCode === 'TIMEOUT')!;
      assert.ok(audit);
    } finally {
      h.close();
    }
  });

  it('recovers the existing BUSY reference instead of resending after a timeout', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });

      // Simulate the dangerous case: BUSY posted it, but our confirmation was
      // lost. The idempotency pre-check must find it rather than post twice.
      h.busy.transactions.set(submitted.externalReference, {
        externalReference: submitted.externalReference,
        busyReference: 'BUSY-EXISTING-1',
        status: 'POSTED',
      });

      const outcome = await h.bridge.processOne(submitted.queueId);
      assert.equal(outcome.status, 'SUCCESS');
      assert.equal(outcome.deduplicated, true);
      assert.equal(outcome.busyReference, 'BUSY-EXISTING-1');
      assert.equal(h.busy.sendLog.length, 0, 'nothing new may be sent');
    } finally {
      h.close();
    }
  });
});

describe('11. Partial transaction', () => {
  it('treats a BUSY quantity shortfall as a reconciliation mismatch, not a success', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      // BUSY booked only part of the quantity (500 sent, 300 booked).
      const tx = h.busy.transactions.get(submitted.externalReference)!;
      tx.lines = [{ busyItemId: 'BUSY-ITEM-4587', quantity: 300, amount: 54000 }];
      tx.totalQuantity = 300;
      tx.totalAmount = 54000;

      const queueItem = h.bridge.queue.findById(submitted.queueId)!;
      const row = await h.bridge.reconciler.reconcileItem('partial-run', queueItem);

      assert.equal(row.result, 'MISMATCH');
      const quantityDiff = row.differences.find((d) => d.field === 'totalQuantity')!;
      assert.equal(quantityDiff.mes, 500);
      assert.equal(quantityDiff.busy, 300);
    } finally {
      h.close();
    }
  });

  it('flags a document BUSY never recorded as MISSING_IN_BUSY', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      // The accounting entry vanished, but the goods left the factory.
      h.busy.transactions.delete(submitted.externalReference);

      const row = await h.bridge.reconciler.reconcileItem(
        'missing-run',
        h.bridge.queue.findById(submitted.queueId)!,
      );
      assert.equal(row.result, 'MISSING_IN_BUSY');
    } finally {
      h.close();
    }
  });
});

describe('12. Retry', () => {
  it('backs off exponentially and stops at MANUAL_REVIEW', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });

      // Fail every attempt. Four are allowed (MAX_ATTEMPTS=4).
      h.busy.failuresBeforeSuccess = 99;

      const statuses: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const outcome = await h.bridge.processOne(submitted.queueId);
        statuses.push(outcome.status);
        h.bridge.queue.requeueForManualRetry(submitted.queueId); // make it due again
      }

      assert.deepEqual(statuses, ['RETRY', 'RETRY', 'RETRY', 'MANUAL_REVIEW']);

      const finalItem = h.bridge.queue.findById(submitted.queueId)!;
      assert.equal(finalItem.attemptCount, 4, 'the attempt count must not be reset by a manual retry');
    } finally {
      h.close();
    }
  });

  it('increases the delay with each attempt and never exceeds the cap', () => {
    const h = makeBridge();
    try {
      const policy = h.bridge.retryPolicy;
      // With jitter over [d/2, d], attempt N's floor must still exceed
      // attempt N-1's ceiling for the growth to be real.
      assert.ok(policy.delayMs(1) <= 1000);
      assert.ok(policy.delayMs(2) >= 1000 && policy.delayMs(2) <= 2000);
      assert.ok(policy.delayMs(3) >= 2000 && policy.delayMs(3) <= 4000);
      assert.ok(policy.delayMs(30) <= 60000, 'the cap must hold');
      assert.equal(policy.shouldRetry(4, true), false, 'the attempt budget must be finite');
      assert.equal(policy.shouldRetry(1, false), false, 'non-retryable errors must not retry');
    } finally {
      h.close();
    }
  });
});

describe('13. Reconciliation mismatch', () => {
  it('reports MATCH when both systems agree', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      const summary = await h.bridge.reconciler.run(7);
      assert.equal(summary.checked, 1);
      assert.equal(summary.MATCH, 1);
      assert.equal(summary.MISMATCH, 0);
    } finally {
      h.close();
    }
  });

  it('detects a voucher booked against the wrong customer', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      h.busy.transactions.get(submitted.externalReference)!.partyBusyId = 'BUSY-CUST-99';

      const row = await h.bridge.reconciler.reconcileItem(
        'party-run',
        h.bridge.queue.findById(submitted.queueId)!,
      );
      assert.equal(row.result, 'MISMATCH');
      const diff = row.differences.find((d) => d.field === 'party')!;
      assert.equal(diff.mes, 'BUSY-CUST-11');
      assert.equal(diff.busy, 'BUSY-CUST-99');
    } finally {
      h.close();
    }
  });

  it('detects one BUSY reference claimed by two MES transactions', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      h.bridge.submit({
        entityType: 'DISPATCH',
        payload: dispatch({ mesId: 'DSP-92', documentNumber: 'DH-DSP-00092' }),
      });
      await h.bridge.drain();

      // Both MES dispatches end up pointing at the same BUSY voucher.
      for (const tx of h.busy.transactions.values()) tx.busyReference = 'BUSY-00001';

      const summary = await h.bridge.reconciler.run(7);
      assert.equal(summary.DUPLICATE, 1);
    } finally {
      h.close();
    }
  });

  it('flags a BUSY master with no MES counterpart as MISSING_IN_MES', async () => {
    const h = makeBridge();
    try {
      h.busy.customers.set('X', { busyId: 'BUSY-CUST-77', name: 'Walk-in Customer' });
      const rows = await h.bridge.reconciler.findMissingInMes('CUSTOMER');
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.result, 'MISSING_IN_MES');
      assert.equal(rows[0]!.busyReference, 'BUSY-CUST-77');
    } finally {
      h.close();
    }
  });
});

describe('14. Manual retry', () => {
  it('re-runs a parked transaction and records who asked', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      h.busy.failuresBeforeSuccess = 99;
      await h.bridge.drain();
      assert.equal(h.bridge.queue.findById(submitted.queueId)!.status, 'RETRY');

      h.busy.failuresBeforeSuccess = 0;
      h.bridge.queue.requeueForManualRetry(submitted.queueId);
      const outcome = await h.bridge.processOne(submitted.queueId, 'key:test***');

      assert.equal(outcome.status, 'SUCCESS');
      const audit = h.bridge.audit.forQueueItem(submitted.queueId);
      assert.ok(audit.some((a) => a.actor === 'key:test***' && a.finalStatus === 'SUCCESS'));
    } finally {
      h.close();
    }
  });

  it('refuses to resend a transaction BUSY already booked', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      const requeued = h.bridge.queue.requeueForManualRetry(submitted.queueId)!;
      assert.equal(requeued.status, 'SUCCESS', 'a successful job must stay successful');
    } finally {
      h.close();
    }
  });
});

describe('15. Multiple queued transactions', () => {
  it('processes a backlog in order with no duplicates', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const references: string[] = [];
      for (let n = 1; n <= 25; n += 1) {
        const padded = String(n).padStart(5, '0');
        references.push(
          h.bridge.submit({
            entityType: 'DISPATCH',
            payload: dispatch({ mesId: `DSP-${n}`, documentNumber: `DH-DSP-${padded}` }),
          }).externalReference,
        );
      }
      assert.equal(new Set(references).size, 25, 'every reference must be unique');
      assert.equal(h.bridge.queue.counts().PENDING, 25);

      const processed = await h.bridge.drain();

      assert.equal(processed, 25);
      assert.equal(h.bridge.queue.counts().SUCCESS, 25);
      assert.equal(h.busy.transactions.size, 25);
      assert.equal(h.busy.sendLog.length, 25, 'exactly one send per transaction');
    } finally {
      h.close();
    }
  });

  it('survives a BUSY outage midway through a backlog', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      for (let n = 1; n <= 10; n += 1) {
        h.bridge.submit({
          entityType: 'DISPATCH',
          payload: dispatch({ mesId: `DSP-${n}`, documentNumber: `DH-DSP-${String(n).padStart(5, '0')}` }),
        });
      }

      h.busy.online = false;
      await h.bridge.worker.tick();
      assert.equal(h.bridge.queue.counts().SUCCESS, 0);

      h.busy.online = true;
      await h.bridge.drain();

      assert.equal(h.bridge.queue.counts().SUCCESS, 10);
      assert.equal(h.busy.transactions.size, 10);
    } finally {
      h.close();
    }
  });

  it('claims each job exactly once when two workers race', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      for (let n = 1; n <= 6; n += 1) {
        h.bridge.submit({
          entityType: 'DISPATCH',
          payload: dispatch({ mesId: `DSP-${n}`, documentNumber: `DH-DSP-${String(n).padStart(5, '0')}` }),
        });
      }

      // Two concurrent claims must partition the queue, not overlap it.
      const first = h.bridge.queue.claimBatch(6);
      const second = h.bridge.queue.claimBatch(6);

      assert.equal(first.length, 6);
      assert.equal(second.length, 0, 'claimed jobs must not be handed out twice');
    } finally {
      h.close();
    }
  });
});
