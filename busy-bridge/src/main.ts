import { loadConfig } from './config';
import { Bridge } from './bridge';
import { createServer } from './api/server';
import { log } from './logger';

/**
 * Entry point.
 *
 * Starts the HTTP surface and the queue worker. The worker keeps draining
 * while BUSY is reachable and holds the queue while it is not; MES is never
 * blocked either way.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const bridge = new Bridge(config);

  const status = await bridge.adapter.testConnection();
  log.info('BUSY connectivity at startup', {
    adapter: bridge.adapter.name,
    online: status.online,
    message: status.message,
  });
  if (!status.online) {
    // Not fatal, by design. Offline BUSY must never stop the bridge from
    // accepting work from MES.
    log.warn('BUSY is not reachable; transactions will queue until it returns.');
  }

  bridge.start();

  const server = createServer(bridge);
  server.listen(config.port, config.bindHost, () => {
    log.info('BUSY bridge listening', {
      url: `http://${config.bindHost}:${config.port}`,
      dashboard: `http://${config.bindHost}:${config.port}/dashboard`,
      adapter: config.adapter,
    });
  });

  const shutdown = (signal: string) => {
    log.info('Shutting down', { signal });
    server.close(() => {
      void bridge.stop().then(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('Fatal startup error', { message: String(err?.message ?? err) });
  process.exit(1);
});
