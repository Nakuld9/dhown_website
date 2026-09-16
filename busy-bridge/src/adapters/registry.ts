import type { Config } from '../config';
import type { BusyAdapter } from './BusyAdapter';
import { BusyXmlFileAdapter } from './xml/BusyXmlFileAdapter';
import { BusyRestAdapter } from './rest/BusyRestAdapter';
import { InMemoryBusyAdapter } from './memory/InMemoryBusyAdapter';

/**
 * The single place that knows which BUSY transports exist.
 *
 * Adding a transport = one new class implementing BusyAdapter + one case here
 * + one environment variable. No MES business logic changes.
 */
export function createAdapter(config: Config): BusyAdapter {
  switch (config.adapter) {
    case 'xml':
      return new BusyXmlFileAdapter(config.xml);
    case 'rest':
      return new BusyRestAdapter({
        baseUrl: config.rest.baseUrl,
        apiKey: config.rest.apiKey,
        timeoutMs: config.rest.timeoutMs,
      });
    case 'memory':
      if (config.env === 'production') {
        // A fake BUSY in production would report every dispatch as posted
        // while nothing reached the accounts. Refuse at startup.
        throw new Error(
          'BUSY_ADAPTER=memory is a test double and must not be used in production. ' +
            'Set BUSY_ADAPTER=xml (or rest) — see docs/BUSY_INTEGRATION.md.',
        );
      }
      return new InMemoryBusyAdapter();
    default: {
      const exhaustive: never = config.adapter;
      throw new Error(`Unknown BUSY adapter "${exhaustive}".`);
    }
  }
}

export { BusyXmlFileAdapter, BusyRestAdapter, InMemoryBusyAdapter };
