import type { Db } from '../db';
import { now } from '../db';
import type { BusyAdapter } from '../adapters/BusyAdapter';
import type { QueueStore } from './queueStore';
import type { SyncService } from './syncService';
import { classifyError } from '../errors';
import { log } from '../logger';

/**
 * The queue worker.
 *
 * Offline mode is the whole point of this loop: when BUSY is unreachable the
 * worker backs off and the queue simply grows. MES keeps accepting dispatches,
 * the factory keeps running, and nothing is lost. When BUSY returns, the queue
 * drains in order.
 */

export interface WorkerOptions {
  pollIntervalMs: number;
  batchSize: number;
  /** PROCESSING rows older than this are assumed orphaned by a crashed worker. */
  staleProcessingMs?: number;
}

export interface ConnectionState {
  online: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  adapter: string | null;
}

export class QueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;

  constructor(
    private readonly db: Db,
    private readonly queue: QueueStore,
    private readonly sync: SyncService,
    private readonly adapter: BusyAdapter,
    private readonly opts: WorkerOptions,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    log.info('Queue worker started', { pollIntervalMs: this.opts.pollIntervalMs, adapter: this.adapter.name });
    const loop = () => {
      if (this.stopped) return;
      void this.tick().finally(() => {
        if (!this.stopped) {
          this.timer = setTimeout(loop, this.opts.pollIntervalMs);
          this.timer.unref?.();
        }
      });
    };
    this.timer = setTimeout(loop, 0);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Let an in-flight tick finish so we never abandon a job mid-send.
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }

  /**
   * One pass. Exposed so tests can drive the worker deterministically instead
   * of sleeping and hoping.
   */
  async tick(): Promise<{ processed: number; online: boolean }> {
    if (this.running) return { processed: 0, online: this.connectionState().online };
    this.running = true;
    try {
      this.releaseStale();

      const status = await this.adapter.testConnection();
      this.recordConnection(status.online, status.online ? null : 'CONNECTION_ERROR', status.message);

      if (!status.online) {
        // BUSY is down. Do not burn attempt budget on jobs that cannot
        // possibly succeed — that would march them to MANUAL_REVIEW during a
        // routine outage. Leave them queued.
        log.debug('BUSY offline; holding queue', { message: status.message });
        return { processed: 0, online: false };
      }

      // Collect acknowledgements for anything handed over asynchronously.
      await this.sync.pollAwaitingBusy();

      const batch = this.queue.claimBatch(this.opts.batchSize);
      let processed = 0;
      for (const item of batch) {
        await this.sync.process(item);
        processed += 1;
      }
      if (processed > 0) log.info('Queue batch processed', { processed });
      return { processed, online: true };
    } catch (err) {
      const be = classifyError(err);
      this.recordConnection(false, be.code, be.message);
      log.error('Queue worker tick failed', { code: be.code, message: be.message });
      return { processed: 0, online: false };
    } finally {
      this.running = false;
    }
  }

  private releaseStale(): void {
    const staleMs = this.opts.staleProcessingMs ?? Math.max(this.opts.pollIntervalMs * 10, 60_000);
    const released = this.queue.releaseStaleProcessing(new Date(Date.now() - staleMs));
    if (released > 0) log.warn('Released orphaned PROCESSING jobs', { released });
  }

  private recordConnection(online: boolean, errorCode: string | null, message: string | null): void {
    this.db
      .prepare(
        `UPDATE busy_connection_state
            SET online = ?, last_checked_at = ?, adapter = ?,
                last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
                last_error_code = ?, last_error_message = ?
          WHERE id = 1`,
      )
      .run(online ? 1 : 0, now(), this.adapter.name, online ? 1 : 0, now(), errorCode, message);
  }

  connectionState(): ConnectionState {
    const row = this.db.prepare('SELECT * FROM busy_connection_state WHERE id = 1').get() as Record<string, any>;
    return {
      online: row.online === 1,
      lastCheckedAt: row.last_checked_at,
      lastSuccessAt: row.last_success_at,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      adapter: row.adapter,
    };
  }
}
