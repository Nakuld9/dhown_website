import * as path from 'node:path';

/**
 * Configuration is read from the environment only.
 *
 * SECURITY (per spec): BUSY credentials live here and nowhere else. They are
 * never written into frontend assets, never logged, and never returned by any
 * HTTP route — see `redactedConfig()`, which is what the dashboard sees.
 */

export type AdapterName = 'xml' | 'rest' | 'memory';

export type EntityType =
  | 'CUSTOMER'
  | 'VENDOR'
  | 'ITEM'
  | 'WAREHOUSE'
  | 'SALES_REFERENCE'
  | 'PURCHASE_REFERENCE'
  | 'DISPATCH'
  | 'INVOICE';

export const ALL_ENTITY_TYPES: EntityType[] = [
  'CUSTOMER',
  'VENDOR',
  'ITEM',
  'WAREHOUSE',
  'SALES_REFERENCE',
  'PURCHASE_REFERENCE',
  'DISPATCH',
  'INVOICE',
];

export type Role = 'viewer' | 'operator' | 'admin';

export interface Config {
  env: string;
  port: number;
  bindHost: string;
  databasePath: string;
  mesApiKey: string;
  /** apiKey -> role. Never serialised anywhere. */
  adminKeys: Map<string, Role>;
  adapter: AdapterName;
  xml: {
    outbox: string;
    ack: string;
    inbox: string;
    archive: string;
    companyName: string;
  };
  rest: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
  };
  queue: {
    pollIntervalMs: number;
    batchSize: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  };
  enabledEntityTypes: Set<EntityType>;
  reconcile: {
    intervalMs: number;
    lookbackDays: number;
  };
}

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  return n;
}

function parseAdminKeys(raw: string): Map<string, Role> {
  const map = new Map<string, Role>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx <= 0) throw new Error('BRIDGE_ADMIN_KEYS entries must be "key:role"');
    const key = trimmed.slice(0, idx);
    const role = trimmed.slice(idx + 1) as Role;
    if (role !== 'viewer' && role !== 'operator' && role !== 'admin') {
      throw new Error(`Unknown role "${role}" in BRIDGE_ADMIN_KEYS (expected viewer|operator|admin)`);
    }
    map.set(key, role);
  }
  return map;
}

function parseEntityTypes(raw: string): Set<EntityType> {
  const set = new Set<EntityType>();
  for (const entry of raw.split(',')) {
    const t = entry.trim().toUpperCase() as EntityType;
    if (!t) continue;
    if (!ALL_ENTITY_TYPES.includes(t)) {
      throw new Error(`Unknown entity type "${t}" in ENABLED_ENTITY_TYPES`);
    }
    set.add(t);
  }
  return set;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const prev = process.env;
  process.env = env;
  try {
    const adapter = str('BUSY_ADAPTER', 'xml') as AdapterName;
    if (adapter !== 'xml' && adapter !== 'rest' && adapter !== 'memory') {
      throw new Error(`Unknown BUSY_ADAPTER "${adapter}" (expected xml|rest|memory)`);
    }
    const dataRoot = (p: string) => path.resolve(p);

    const config: Config = {
      env: str('NODE_ENV', 'development'),
      port: int('PORT', 4010),
      bindHost: str('BIND_HOST', '127.0.0.1'),
      databasePath: dataRoot(str('DATABASE_PATH', './data/busy-bridge.db')),
      mesApiKey: str('MES_API_KEY', 'dev-mes-key'),
      adminKeys: parseAdminKeys(str('BRIDGE_ADMIN_KEYS', 'dev-admin-key:admin')),
      adapter,
      xml: {
        outbox: dataRoot(str('BUSY_XML_OUTBOX', './data/busy/outbox')),
        ack: dataRoot(str('BUSY_XML_ACK', './data/busy/ack')),
        inbox: dataRoot(str('BUSY_XML_INBOX', './data/busy/inbox')),
        archive: dataRoot(str('BUSY_XML_ARCHIVE', './data/busy/archive')),
        companyName: str('BUSY_COMPANY_NAME', 'DHOWN'),
      },
      rest: {
        baseUrl: str('BUSY_REST_BASE_URL', ''),
        apiKey: str('BUSY_REST_API_KEY', ''),
        timeoutMs: int('BUSY_REST_TIMEOUT_MS', 15000),
      },
      queue: {
        pollIntervalMs: int('QUEUE_POLL_INTERVAL_MS', 5000),
        batchSize: int('QUEUE_BATCH_SIZE', 10),
        maxAttempts: int('MAX_ATTEMPTS', 4),
        retryBaseDelayMs: int('RETRY_BASE_DELAY_MS', 30000),
        retryMaxDelayMs: int('RETRY_MAX_DELAY_MS', 3600000),
      },
      enabledEntityTypes: parseEntityTypes(
        str('ENABLED_ENTITY_TYPES', 'CUSTOMER,VENDOR,ITEM,SALES_REFERENCE,PURCHASE_REFERENCE,DISPATCH,INVOICE'),
      ),
      reconcile: {
        intervalMs: int('RECONCILE_INTERVAL_MS', 900000),
        lookbackDays: int('RECONCILE_LOOKBACK_DAYS', 7),
      },
    };

    if (config.adapter === 'rest' && !config.rest.baseUrl) {
      throw new Error('BUSY_ADAPTER=rest requires BUSY_REST_BASE_URL to be set.');
    }
    return config;
  } finally {
    process.env = prev;
  }
}

/**
 * The only shape of config allowed to leave the process. Secrets are replaced
 * with a presence flag so operators can confirm "a key is configured" without
 * the key itself ever reaching a browser.
 */
export function redactedConfig(config: Config) {
  return {
    env: config.env,
    adapter: config.adapter,
    enabledEntityTypes: [...config.enabledEntityTypes],
    queue: config.queue,
    reconcile: config.reconcile,
    xml: {
      // Paths are operational facts, not secrets, and operators need them to
      // diagnose "BUSY isn't picking files up".
      outbox: config.xml.outbox,
      ack: config.xml.ack,
      inbox: config.xml.inbox,
      companyName: config.xml.companyName,
    },
    rest: {
      baseUrl: config.rest.baseUrl,
      apiKeyConfigured: config.rest.apiKey.length > 0,
      timeoutMs: config.rest.timeoutMs,
    },
    mesApiKeyConfigured: config.mesApiKey.length > 0,
    adminKeyCount: config.adminKeys.size,
  };
}
