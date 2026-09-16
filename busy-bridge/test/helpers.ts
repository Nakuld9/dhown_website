import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, type Config } from '../src/config';
import { Bridge } from '../src/bridge';
import { InMemoryBusyAdapter } from '../src/adapters/memory/InMemoryBusyAdapter';
import { setLogLevel } from '../src/logger';

setLogLevel('error'); // keep test output readable

const tempDirs: string[] = [];

export function tempDir(prefix = 'busy-bridge-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  const dir = tempDir();
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: path.join(dir, 'bridge.db'),
    BUSY_ADAPTER: 'memory',
    MES_API_KEY: 'test-mes-key',
    BRIDGE_ADMIN_KEYS: 'test-admin-key:admin,test-viewer-key:viewer,test-op-key:operator',
    BUSY_XML_OUTBOX: path.join(dir, 'outbox'),
    BUSY_XML_ACK: path.join(dir, 'ack'),
    BUSY_XML_INBOX: path.join(dir, 'inbox'),
    BUSY_XML_ARCHIVE: path.join(dir, 'archive'),
    MAX_ATTEMPTS: '4',
    RETRY_BASE_DELAY_MS: '1000',
    RETRY_MAX_DELAY_MS: '60000',
    QUEUE_BATCH_SIZE: '10',
    RECONCILE_INTERVAL_MS: '0',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export interface TestHarness {
  bridge: Bridge;
  busy: InMemoryBusyAdapter;
  close(): void;
}

export function makeBridge(overrides: Record<string, string> = {}): TestHarness {
  const config = testConfig(overrides);
  const busy = new InMemoryBusyAdapter();
  const bridge = new Bridge(config, busy);
  return {
    bridge,
    busy,
    close() {
      bridge.db.close();
    },
  };
}

// --- fixtures --------------------------------------------------------------

export const customer = (over: Record<string, unknown> = {}) => ({
  mesId: 'CUST-00042',
  name: 'Verma Textiles Pvt Ltd',
  code: 'CUST-00042',
  gstin: '03AABCV1234D1Z5',
  email: 'accounts@vermatextiles.example',
  phone: '+91 98765 43210',
  billingAddress: { line1: 'Plot 14, Focal Point', city: 'Ludhiana', state: 'Punjab', stateCode: '03', pincode: '141003' },
  creditDays: 30,
  ...over,
});

export const vendor = (over: Record<string, unknown> = {}) => ({
  mesId: 'VEND-00007',
  name: 'Nahar Yarns',
  gstin: '03AAACN1234F1Z2',
  ...over,
});

export const item = (over: Record<string, unknown> = {}) => ({
  mesId: 'FC-00125',
  name: 'Cotton Fleece 240 GSM',
  code: 'FC-00125',
  unit: 'MTR',
  hsnCode: '60063200',
  gstRate: 5,
  ...over,
});

export const dispatch = (over: Record<string, unknown> = {}) => ({
  mesId: 'DSP-91',
  documentNumber: 'DH-DSP-00091',
  documentDate: '2026-09-16',
  fiscalYear: '2026',
  customerMesId: 'CUST-00042',
  lines: [{ itemMesId: 'FC-00125', quantity: 500, unit: 'MTR', rate: 180, amount: 90000 }],
  vehicleNumber: 'PB10AB1234',
  ...over,
});

export const invoice = (over: Record<string, unknown> = {}) => ({
  mesId: 'INV-91',
  documentNumber: 'DH-INV-00091',
  documentDate: '2026-09-16',
  fiscalYear: '2026',
  customerMesId: 'CUST-00042',
  dispatchMesId: 'DSP-91',
  lines: [{ itemMesId: 'FC-00125', quantity: 500, unit: 'MTR', rate: 180, amount: 90000 }],
  taxableAmount: 90000,
  taxAmount: 4500,
  totalAmount: 94500,
  ...over,
});

/** Map the fixtures' masters so document tests can focus on the document. */
export function seedMappings(h: TestHarness): void {
  h.bridge.mappings.setManualMapping('CUSTOMER', 'CUST-00042', 'BUSY-CUST-11', 'VERMA');
  h.bridge.mappings.setManualMapping('VENDOR', 'VEND-00007', 'BUSY-VEND-04', 'NAHAR');
  h.bridge.mappings.setManualMapping('ITEM', 'FC-00125', 'BUSY-ITEM-4587', 'BUSY-4587');
}
