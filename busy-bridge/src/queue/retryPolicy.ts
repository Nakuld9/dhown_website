/**
 * Exponential backoff with bounded attempts.
 *
 * Attempt 1 -> Attempt 2 -> Attempt 3 -> Attempt 4 -> MANUAL_REVIEW
 *
 * Two deliberate properties:
 *
 *  - It STOPS. After maxAttempts the job is parked in MANUAL_REVIEW for a
 *    human. Retrying forever turns one bad record into permanent load and
 *    hides the failure instead of surfacing it.
 *
 *  - Jitter. Without it, a BUSY outage that fails 200 queued jobs makes all
 *    200 retry in the same millisecond when it recovers, and knocks it over
 *    again. Jitter is full-width: the delay is uniform in [base/2, base].
 */

export interface RetryPolicyOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export class RetryPolicy {
  constructor(
    private readonly opts: RetryPolicyOptions,
    /** Injectable for deterministic tests. */
    private readonly random: () => number = Math.random,
  ) {}

  get maxAttempts(): number {
    return this.opts.maxAttempts;
  }

  /** Should a job that has now made `attemptCount` attempts be retried? */
  shouldRetry(attemptCount: number, retryable: boolean): boolean {
    if (!retryable) return false;
    return attemptCount < this.opts.maxAttempts;
  }

  /** Delay before the attempt that follows `attemptCount` completed attempts. */
  delayMs(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    const uncapped = this.opts.baseDelayMs * 2 ** exponent;
    const capped = Math.min(uncapped, this.opts.maxDelayMs);
    // Full jitter across the lower half keeps ordering roughly intact while
    // still spreading a recovering thundering herd.
    return Math.round(capped / 2 + this.random() * (capped / 2));
  }

  nextRetryAt(attemptCount: number, from: Date = new Date()): Date {
    return new Date(from.getTime() + this.delayMs(attemptCount));
  }
}
