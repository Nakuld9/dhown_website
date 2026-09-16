import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cleanupTempDirs, customer, dispatch, makeBridge, seedMappings, tempDir, testConfig } from './helpers';
import { BusyXmlFileAdapter } from '../src/adapters/xml/BusyXmlFileAdapter';
import { InMemoryBusyAdapter } from '../src/adapters/memory/InMemoryBusyAdapter';
import { createAdapter } from '../src/adapters/registry';
import { buildExternalReference, deriveSequence, parseExternalReference } from '../src/domain/externalRef';
import { redactedConfig } from '../src/config';
import { redact } from '../src/logger';
import { classifyError, BridgeError } from '../src/errors';
import { dispatchToXml, esc } from '../src/transform/busyXml';
import { Bridge } from '../src/bridge';

after(cleanupTempDirs);

// ---------------------------------------------------------------------------

describe('Idempotency keys', () => {
  it('derives a stable reference from the MES document number', () => {
    const a = buildExternalReference('DISPATCH', 'DH-DSP-00091', '2026');
    const b = buildExternalReference('DISPATCH', 'DH-DSP-00091', '2026');
    assert.equal(a, 'DHOWN-DISPATCH-2026-000091');
    assert.equal(a, b, 'the same document must always produce the same key');
  });

  it('distinguishes documents that differ only in sequence', () => {
    assert.notEqual(
      buildExternalReference('DISPATCH', 'DH-DSP-00091', '2026'),
      buildExternalReference('DISPATCH', 'DH-DSP-00092', '2026'),
    );
  });

  it('takes the last numeric group so year-bearing numbers still work', () => {
    assert.equal(deriveSequence('DH/INV/2026/0042'), '000042');
  });

  it('refuses a document number it cannot key deterministically', () => {
    assert.throws(() => buildExternalReference('DISPATCH', 'DISPATCH-NOTE', '2026'), /no digits/);
  });

  it('round-trips through the parser', () => {
    const parsed = parseExternalReference('DHOWN-SALES_REFERENCE-2026-000091')!;
    assert.equal(parsed.entityType, 'SALES_REFERENCE');
    assert.equal(parsed.year, '2026');
    assert.equal(parsed.sequence, '000091');
  });
});

// ---------------------------------------------------------------------------

describe('Retry backoff', () => {
  it('holds a failed job until its backoff has elapsed', async () => {
    // Regression: timestamps were once stored to whole seconds, so a
    // sub-second backoff rounded down to "due now" and the job was re-claimed
    // immediately — the delay silently did nothing.
    const h = makeBridge({ RETRY_BASE_DELAY_MS: '60000' });
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      h.busy.failuresBeforeSuccess = 99;

      await h.bridge.processOne(submitted.queueId);
      assert.equal(h.bridge.queue.findById(submitted.queueId)!.status, 'RETRY');

      // Due only in the future, so a claim right now must find nothing.
      assert.equal(h.bridge.queue.claimBatch(10).length, 0);

      // ...and must find it once the clock passes the backoff.
      const later = new Date(Date.now() + 120_000);
      assert.equal(h.bridge.queue.claimBatch(10, later).length, 1);
    } finally {
      h.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('BUSY XML file adapter', () => {
  function xmlAdapter() {
    const dir = tempDir('busy-xml-');
    const opts = {
      outbox: path.join(dir, 'outbox'),
      ack: path.join(dir, 'ack'),
      inbox: path.join(dir, 'inbox'),
      archive: path.join(dir, 'archive'),
      companyName: 'DHOWN',
    };
    return { adapter: new BusyXmlFileAdapter(opts), opts };
  }

  const ctx = {
    externalReference: 'DHOWN-DISPATCH-2026-000091',
    partyBusyId: 'BUSY-CUST-11',
    itemBusyIds: { 'FC-00125': { busyId: 'BUSY-ITEM-4587', busyCode: 'BUSY-4587' } },
    attempt: 1,
  };

  it('reports online only when the exchange directory is really writable', async () => {
    const { adapter } = xmlAdapter();
    const status = await adapter.testConnection();
    assert.equal(status.online, true);
  });

  it('reports offline when the BUSY share is unreachable', async () => {
    const adapter = new BusyXmlFileAdapter({
      // A path under a regular file can never be created: stands in for an
      // unmounted share.
      outbox: '/dev/null/outbox',
      ack: '/dev/null/ack',
      inbox: '/dev/null/inbox',
      archive: '/dev/null/archive',
      companyName: 'DHOWN',
    });
    const status = await adapter.testConnection();
    assert.equal(status.online, false);
    assert.match(status.message, /not reachable/i);
  });

  it('writes the voucher under its external reference and reports ACCEPTED, not POSTED', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    const result = await adapter.sendDispatch(dispatch() as any, ctx);

    // The hand-off is asynchronous: claiming POSTED here would put a reference
    // into MES that BUSY has not issued.
    assert.equal(result.status, 'ACCEPTED');
    assert.equal(result.busyReference, undefined);

    const written = fs.readFileSync(path.join(opts.outbox, `${ctx.externalReference}.xml`), 'utf8');
    assert.match(written, /<VOUCHERTYPE>Delivery Challan<\/VOUCHERTYPE>/);
    assert.match(written, /<EXTERNALREFERENCE>DHOWN-DISPATCH-2026-000091<\/EXTERNALREFERENCE>/);
    // The BUSY item id must appear, never the MES one.
    assert.match(written, /<ITEMID>BUSY-ITEM-4587<\/ITEMID>/);
    assert.ok(!written.includes('<ITEMID>FC-00125</ITEMID>'));
    // No partial temp files left behind.
    assert.deepEqual(
      fs.readdirSync(opts.outbox).filter((f) => f.startsWith('.')),
      [],
    );
  });

  it('refuses to write a second file for the same external reference', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    await adapter.sendDispatch(dispatch() as any, ctx);
    const second = await adapter.sendDispatch(dispatch() as any, ctx);

    assert.equal(second.status, 'DUPLICATE');
    assert.equal(fs.readdirSync(opts.outbox).filter((f) => f.endsWith('.xml')).length, 1);
  });

  it('reads the BUSY reference back out of an acknowledgement', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    await adapter.sendDispatch(dispatch() as any, ctx);

    fs.writeFileSync(
      path.join(opts.ack, `${ctx.externalReference}.ack.xml`),
      `<?xml version="1.0"?><ACK><STATUS>SUCCESS</STATUS><BUSYREFERENCE>SL/2026/0912</BUSYREFERENCE>
       <VOUCHERNO>DH-DSP-00091</VOUCHERNO><PARTYID>BUSY-CUST-11</PARTYID>
       <ITEMS><ITEM><ITEMID>BUSY-ITEM-4587</ITEMID><QTY>500</QTY><AMOUNT>90000</AMOUNT></ITEM></ITEMS>
       <TOTALAMOUNT>90000</TOTALAMOUNT></ACK>`,
      'utf8',
    );

    const status = await adapter.getTransactionStatus(ctx.externalReference);
    assert.equal(status.status, 'POSTED');
    assert.equal(status.busyReference, 'SL/2026/0912');

    const snapshot = (await adapter.reconcileTransaction(ctx.externalReference))!;
    assert.equal(snapshot.totalQuantity, 500);
    assert.equal(snapshot.lines![0]!.busyItemId, 'BUSY-ITEM-4587');
  });

  it('surfaces a BUSY rejection verbatim instead of guessing', async () => {
    const { adapter, opts } = xmlAdapter();
    await adapter.testConnection();
    fs.writeFileSync(
      path.join(opts.ack, `${ctx.externalReference}.ack.xml`),
      '<ACK><STATUS>ERROR</STATUS><MESSAGE>Item code BUSY-4587 does not exist</MESSAGE></ACK>',
      'utf8',
    );
    const status = await adapter.getTransactionStatus(ctx.externalReference);
    assert.equal(status.status, 'REJECTED');
    assert.equal(status.message, 'Item code BUSY-4587 does not exist');
  });

  it('says UNKNOWN when BUSY has never seen the reference', async () => {
    const { adapter } = xmlAdapter();
    await adapter.testConnection();
    const status = await adapter.getTransactionStatus('DHOWN-DISPATCH-2026-999999');
    assert.equal(status.status, 'UNKNOWN');
  });

  it('refuses a reference that would escape the outbox directory', async () => {
    const { adapter } = xmlAdapter();
    await adapter.testConnection();
    await assert.rejects(
      () => adapter.getTransactionStatus('../../etc/passwd'),
      (err: any) => err.code === 'VALIDATION_ERROR',
    );
  });

  it('escapes XML metacharacters in free text', () => {
    assert.equal(esc('Sharma & Co <"quoted">'), 'Sharma &amp; Co &lt;&quot;quoted&quot;&gt;');
    const xml = dispatchToXml(
      dispatch({ notes: 'Rate revised <urgent> & confirmed' }) as any,
      ctx as any,
      'DHOWN',
    );
    assert.match(xml, /Rate revised &lt;urgent&gt; &amp; confirmed/);
    assert.ok(!xml.includes('<urgent>'));
  });

  it('declares an asynchronous send in its capabilities', () => {
    const { adapter } = xmlAdapter();
    assert.equal(adapter.capabilities().synchronousSend, false);
    assert.equal(adapter.capabilities().sendDispatch, true);
  });
});

// ---------------------------------------------------------------------------

describe('Adapter replaceability', () => {
  it('refuses the in-memory test double in production', () => {
    const config = testConfig({ NODE_ENV: 'production', BUSY_ADAPTER: 'memory' });
    assert.throws(() => createAdapter(config), /must not be used in production/);
  });

  it('requires a base URL before the REST gateway can be selected', () => {
    assert.throws(() => testConfig({ BUSY_ADAPTER: 'rest', BUSY_REST_BASE_URL: '' }), /BUSY_REST_BASE_URL/);
  });

  it('refuses an unsupported operation rather than faking it', async () => {
    const busy = new InMemoryBusyAdapter();
    busy.unsupported.add('sendDispatch');
    const h = { bridge: new Bridge(testConfig(), busy) };
    try {
      seedMappings(h as any);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await h.bridge.drain();

      const queued = h.bridge.queue.findById(submitted.queueId)!;
      assert.equal(queued.status, 'MANUAL_REVIEW');
      assert.equal(queued.errorCode, 'UNSUPPORTED_OPERATION');
      // Crucially: nothing was invented on the BUSY side.
      assert.equal(busy.transactions.size, 0);
    } finally {
      h.bridge.db.close();
    }
  });

  it('completes the loop when an asynchronous hand-off is later acknowledged', async () => {
    const busy = new InMemoryBusyAdapter();
    busy.synchronous = false; // behave like the file-drop transport
    const bridge = new Bridge(testConfig(), busy);
    try {
      bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11');
      bridge.mappings.setManualMapping('ITEM', 'FC-00125', 'BUSY-ITEM-4587');
      const submitted = bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });
      await bridge.drain();

      // Handed over, but not yet booked — MES must not be told otherwise.
      let queued = bridge.queue.findById(submitted.queueId)!;
      assert.equal(queued.status, 'AWAITING_BUSY');
      assert.equal(queued.busyReference, null);

      // BUSY finishes its import.
      const reference = busy.completeAsync(submitted.externalReference);
      await bridge.sync.pollAwaitingBusy();

      queued = bridge.queue.findById(submitted.queueId)!;
      assert.equal(queued.status, 'SUCCESS');
      assert.equal(queued.busyReference, reference);
    } finally {
      bridge.db.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('Error classification', () => {
  it('marks transport faults retryable and data faults not', () => {
    assert.equal(new BridgeError('CONNECTION_ERROR', 'x').retryable, true);
    assert.equal(new BridgeError('TIMEOUT', 'x').retryable, true);
    assert.equal(new BridgeError('VALIDATION_ERROR', 'x').retryable, false);
    assert.equal(new BridgeError('MASTER_MAPPING_ERROR', 'x').retryable, false);
    assert.equal(new BridgeError('DUPLICATE_ERROR', 'x').retryable, false);
    assert.equal(new BridgeError('AUTHENTICATION_ERROR', 'x').retryable, false);
  });

  it('maps socket errors onto the right class', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    assert.equal(classifyError(refused).code, 'CONNECTION_ERROR');

    const missingShare = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    assert.equal(classifyError(missingShare).code, 'CONNECTION_ERROR');

    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    assert.equal(classifyError(aborted).code, 'TIMEOUT');
  });

  it('never loses an unclassifiable failure', () => {
    const classified = classifyError(new Error('something odd'));
    assert.equal(classified.code, 'UNKNOWN_ERROR');
    assert.equal(classified.retryable, true, 'unknown failures get a bounded number of retries');
  });

  it('explains a mapping failure the way an operator needs it', () => {
    const err = new BridgeError('MASTER_MAPPING_ERROR', 'no mapping', { subject: 'FC-00125', entityType: 'ITEM' });
    const { reason, action } = err.explain();
    assert.equal(reason, 'MES item "FC-00125" is not mapped to a BUSY item.');
    assert.match(action, /Map MES item "FC-00125"/);
  });
});

// ---------------------------------------------------------------------------

describe('Security', () => {
  it('never exposes BUSY or bridge credentials through the config view', () => {
    const config = testConfig({ BUSY_ADAPTER: 'rest', BUSY_REST_BASE_URL: 'https://gw.example', BUSY_REST_API_KEY: 'super-secret-busy-key' });
    const view = JSON.stringify(redactedConfig(config));

    assert.ok(!view.includes('super-secret-busy-key'), 'the BUSY key must not be serialisable');
    assert.ok(!view.includes('test-mes-key'), 'the MES key must not be serialisable');
    assert.ok(!view.includes('test-admin-key'), 'admin keys must not be serialisable');
    assert.match(view, /"apiKeyConfigured":true/, 'operators still see that a key is set');
  });

  it('redacts credential-shaped fields before anything is logged', () => {
    const redacted = redact({
      externalReference: 'DHOWN-DISPATCH-2026-000091',
      busyApiKey: 'secret-value',
      nested: { authorization: 'Bearer abc', password: 'hunter2' },
    }) as any;

    assert.equal(redacted.externalReference, 'DHOWN-DISPATCH-2026-000091');
    assert.equal(redacted.busyApiKey, '[redacted]');
    assert.equal(redacted.nested.authorization, '[redacted]');
    assert.equal(redacted.nested.password, '[redacted]');
  });

  it('refuses an entity type that has not been enabled', () => {
    const h = makeBridge({ ENABLED_ENTITY_TYPES: 'CUSTOMER,ITEM' });
    try {
      assert.throws(
        () => h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() }),
        (err: any) => err.code === 'VALIDATION_ERROR' && /not enabled/.test(err.message),
      );
    } finally {
      h.close();
    }
  });

  it('will not let two MES records claim the same BUSY ledger', () => {
    const h = makeBridge();
    try {
      h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11');
      assert.throws(
        () => h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00099', 'BUSY-CUST-11'),
        /already mapped/,
      );
    } finally {
      h.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('Audit trail', () => {
  it('records every attempt, including the ones that failed', async () => {
    const h = makeBridge();
    try {
      seedMappings(h);
      const submitted = h.bridge.submit({ entityType: 'DISPATCH', payload: dispatch() });

      h.busy.failuresBeforeSuccess = 1;
      await h.bridge.processOne(submitted.queueId);
      h.busy.failuresBeforeSuccess = 0;
      h.bridge.queue.requeueForManualRetry(submitted.queueId);
      await h.bridge.processOne(submitted.queueId, 'key:oper***');

      const entries = h.bridge.audit.forQueueItem(submitted.queueId);
      const statuses = entries.map((e) => e.finalStatus);

      assert.ok(statuses.includes('QUEUED'));
      assert.ok(statuses.includes('RETRY'), 'the failure must survive in the trail');
      assert.ok(statuses.includes('SUCCESS'));

      const failure = entries.find((e) => e.finalStatus === 'RETRY')!;
      assert.equal(failure.errorCode, 'CONNECTION_ERROR');
      assert.ok(failure.payloadSnapshot, 'the payload we sent must be recoverable');

      const success = entries.find((e) => e.finalStatus === 'SUCCESS')!;
      assert.equal(success.actor, 'key:oper***', 'the trail must say who forced the retry');
      assert.ok(success.busyReference);
    } finally {
      h.close();
    }
  });

  it('records a master sync against the mapping it created', async () => {
    const h = makeBridge();
    try {
      const submitted = h.bridge.submit({ entityType: 'CUSTOMER', payload: customer() });
      await h.bridge.drain();
      const entries = h.bridge.audit.forExternalReference(submitted.externalReference);
      assert.ok(entries.some((e) => e.finalStatus === 'SUCCESS' && e.busyReference));
    } finally {
      h.close();
    }
  });
});
