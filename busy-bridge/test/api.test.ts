import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanupTempDirs, dispatch, makeBridge, seedMappings, type TestHarness } from './helpers';
import { createServer } from '../src/api/server';

/**
 * End-to-end through the HTTP surface, including the auth boundary.
 *
 * The security rules in the specification are structural, so they are asserted
 * here rather than assumed: MES cannot reach admin routes, a viewer cannot
 * force actions, and no BUSY credential is reachable through any response.
 */

let harness: TestHarness;
let server: Server;
let base: string;

before(async () => {
  harness = makeBridge();
  seedMappings(harness);
  server = createServer(harness.bridge);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  harness.close();
  cleanupTempDirs();
});

/**
 * fetch().json() is typed `unknown`. These tests assert on response shape
 * deliberately, so unwrap once here rather than casting at every call site.
 */
async function json(res: Response): Promise<any> {
  return res.json();
}

const MES = { 'X-Bridge-Key': 'test-mes-key', 'Content-Type': 'application/json' };
const ADMIN = { 'X-Admin-Key': 'test-admin-key' };
const VIEWER = { 'X-Admin-Key': 'test-viewer-key' };

describe('Authentication', () => {
  it('rejects an unauthenticated API call', async () => {
    const res = await fetch(`${base}/api/v1/mes/dispatches`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
  });

  it('rejects a wrong key', async () => {
    const res = await fetch(`${base}/api/v1/admin/overview`, { headers: { 'X-Admin-Key': 'nope' } });
    assert.equal(res.status, 401);
  });

  it('answers /health without a key but reveals nothing about BUSY', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.ok, true);
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('adapter'), 'BUSY state is not public information');
    assert.ok(!serialised.includes('key'));
  });

  it('does not let the MES key reach administrative routes', async () => {
    const res = await fetch(`${base}/api/v1/admin/overview`, { headers: { 'X-Bridge-Key': 'test-mes-key' } });
    assert.equal(res.status, 403);
  });

  it('does not let a viewer force a manual action', async () => {
    const res = await fetch(`${base}/api/v1/admin/reconciliation/run`, { method: 'POST', headers: VIEWER });
    assert.equal(res.status, 403);
    const body = await json(res);
    assert.match(body.error.message, /requires the "operator" role/);
  });

  it('lets a viewer read', async () => {
    const res = await fetch(`${base}/api/v1/admin/overview`, { headers: VIEWER });
    assert.equal(res.status, 200);
  });
});

describe('MES internal API', () => {
  it('accepts a dispatch and returns its idempotency key', async () => {
    const res = await fetch(`${base}/api/v1/mes/dispatches`, {
      method: 'POST',
      headers: MES,
      body: JSON.stringify(dispatch({ mesId: 'DSP-500', documentNumber: 'DH-DSP-00500' })),
    });

    assert.equal(res.status, 202, 'accepted for later delivery, not yet in BUSY');
    const body = await json(res);
    assert.equal(body.ok, true);
    assert.equal(body.externalReference, 'DHOWN-DISPATCH-2026-000500');
    assert.equal(body.status, 'PENDING');
    assert.equal(body.busyReference, null);
  });

  it('is idempotent when MES resubmits the same dispatch', async () => {
    const payload = JSON.stringify(dispatch({ mesId: 'DSP-501', documentNumber: 'DH-DSP-00501' }));
    const first = await fetch(`${base}/api/v1/mes/dispatches`, { method: 'POST', headers: MES, body: payload });
    const second = await fetch(`${base}/api/v1/mes/dispatches`, { method: 'POST', headers: MES, body: payload });

    assert.equal(first.status, 202);
    assert.equal(second.status, 200, 'a repeat is a no-op, not a new job');
    assert.equal((await json(first)).queueId, (await json(second)).queueId);
  });

  it('rejects an invalid payload with an actionable explanation', async () => {
    const res = await fetch(`${base}/api/v1/mes/customers`, {
      method: 'POST',
      headers: MES,
      body: JSON.stringify({ mesId: 'CUST-X', name: '', gstin: 'BAD' }),
    });

    assert.equal(res.status, 422);
    const body = await json(res);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.retryable, false);
    assert.ok(body.error.issues.length >= 2);
    assert.ok(body.error.action, 'the operator must be told what to do');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await fetch(`${base}/api/v1/mes/dispatches`, { method: 'POST', headers: MES, body: 'not json' });
    assert.equal(res.status, 422);
  });

  it('reports the BUSY reference back to MES once the queue has run', async () => {
    const payload = dispatch({ mesId: 'DSP-502', documentNumber: 'DH-DSP-00502' });
    const submit = await fetch(`${base}/api/v1/mes/dispatches`, {
      method: 'POST',
      headers: MES,
      body: JSON.stringify(payload),
    });
    const { externalReference } = await json(submit);

    await harness.bridge.drain();

    const res = await fetch(`${base}/api/v1/mes/status/${encodeURIComponent(externalReference)}`, { headers: MES });
    const body = await json(res);

    assert.equal(res.status, 200);
    assert.equal(body.status, 'SUCCESS');
    assert.ok(body.busyReference, 'the BUSY reference must flow back to MES');
  });

  it('404s on an unknown external reference rather than inventing one', async () => {
    const res = await fetch(`${base}/api/v1/mes/status/DHOWN-DISPATCH-2026-999999`, { headers: MES });
    assert.equal(res.status, 404);
  });
});

describe('Admin API', () => {
  it('summarises everything the dashboard needs', async () => {
    const res = await fetch(`${base}/api/v1/admin/overview`, { headers: ADMIN });
    const body = await json(res);

    assert.equal(res.status, 200);
    for (const field of ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'MANUAL_REVIEW', 'RETRY']) {
      assert.ok(field in body.queue, `queue counts must include ${field}`);
    }
    assert.ok('online' in body.connection);
    assert.ok('capabilities' in body.connection);
    assert.ok('todaysTransactions' in body);
    assert.ok('lastSuccessfulSync' in body);
  });

  it('never leaks a credential in the overview', async () => {
    const res = await fetch(`${base}/api/v1/admin/overview`, { headers: ADMIN });
    const text = await res.text();
    assert.ok(!text.includes('test-admin-key'));
    assert.ok(!text.includes('test-mes-key'));
  });

  it('serves the payload and audit trail for one transaction', async () => {
    const list = await json(await fetch(`${base}/api/v1/admin/queue?status=SUCCESS`, { headers: ADMIN }));
    assert.ok(list.items.length > 0);

    const res = await fetch(`${base}/api/v1/admin/queue/${list.items[0].id}`, { headers: ADMIN });
    const body = await json(res);

    assert.equal(res.status, 200);
    assert.equal(typeof body.item.payload, 'object', 'the payload must be viewable');
    assert.ok(Array.isArray(body.audit));
  });

  it('refuses to resend a transaction BUSY already booked', async () => {
    const list = await json(await fetch(`${base}/api/v1/admin/queue?status=SUCCESS`, { headers: ADMIN }));
    const res = await fetch(`${base}/api/v1/admin/queue/${list.items[0].id}/retry`, {
      method: 'POST',
      headers: ADMIN,
    });

    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.code, 'DUPLICATE_ERROR');
  });

  it('lets an operator set a mapping', async () => {
    const res = await fetch(`${base}/api/v1/admin/mappings`, {
      method: 'POST',
      headers: { 'X-Admin-Key': 'test-op-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'ITEM', mesId: 'FC-00999', busyId: 'BUSY-ITEM-9999', busyCode: 'B-9999' }),
    });

    assert.equal(res.status, 200);
    assert.equal((await json(res)).mapping.syncStatus, 'SYNCED');
  });

  it('rejects a mapping that would merge two MES records onto one BUSY record', async () => {
    const res = await fetch(`${base}/api/v1/admin/mappings`, {
      method: 'POST',
      headers: { 'X-Admin-Key': 'test-op-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'ITEM', mesId: 'FC-01000', busyId: 'BUSY-ITEM-9999' }),
    });
    assert.equal(res.status, 409);
  });

  it('runs reconciliation on demand', async () => {
    const res = await fetch(`${base}/api/v1/admin/reconciliation/run`, { method: 'POST', headers: ADMIN });
    const body = await json(res);
    assert.equal(res.status, 200);
    assert.ok(body.summary.checked >= 1);
  });
});

describe('Dashboard assets', () => {
  it('serves the dashboard with a restrictive content security policy', async () => {
    const res = await fetch(`${base}/dashboard`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/, 'the dashboard must not call anything but this service');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });

  it('does not serve files outside the public directory', async () => {
    const res = await fetch(`${base}/dashboard/../package.json`, { redirect: 'manual' });
    assert.notEqual(res.status, 200);
  });

  it('ships no BUSY credentials to the browser', async () => {
    const js = await (await fetch(`${base}/dashboard/dashboard.js`)).text();
    assert.ok(!js.includes('test-mes-key'));
    assert.ok(!js.includes('test-admin-key'));
    // The dashboard must reach BUSY only through this service.
    assert.ok(!/fetch\(\s*['"`]https?:\/\//.test(js), 'the dashboard must make no external requests');
  });
});
