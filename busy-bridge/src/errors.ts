/**
 * Error classification for the BUSY bridge.
 *
 * Every failure that crosses the adapter boundary is classified into one of the
 * codes below. The class decides two things the rest of the system depends on:
 *
 *   1. Is it worth retrying? (transport hiccups yes, bad data no)
 *   2. What does a human have to do about it?
 *
 * Nothing is ever silently discarded. A failure we cannot classify becomes
 * UNKNOWN_ERROR and is surfaced, not swallowed.
 */

export type ErrorCode =
  | 'CONNECTION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'MASTER_MAPPING_ERROR'
  | 'DUPLICATE_ERROR'
  | 'BUSY_TRANSACTION_ERROR'
  | 'TIMEOUT'
  | 'UNSUPPORTED_OPERATION'
  | 'UNKNOWN_ERROR';

/** Whether a given class of failure can be fixed by simply trying again. */
const RETRYABLE: Record<ErrorCode, boolean> = {
  CONNECTION_ERROR: true, // BUSY offline / share unreachable — retry
  TIMEOUT: true, // BUSY busy or slow — retry
  UNKNOWN_ERROR: true, // unclassified: retry a bounded number of times
  AUTHENTICATION_ERROR: false, // bad credentials — retrying cannot help
  VALIDATION_ERROR: false, // bad payload — needs a data fix
  MASTER_MAPPING_ERROR: false, // needs a human to map the master
  DUPLICATE_ERROR: false, // already in BUSY — reconcile, do not resend
  BUSY_TRANSACTION_ERROR: false, // BUSY rejected it on business grounds
  UNSUPPORTED_OPERATION: false, // this BUSY install cannot do it at all
};

export interface BridgeErrorDetails {
  /** Machine-readable hint for the dashboard's remediation buttons. */
  action?: 'FIX_MAPPING' | 'FIX_DATA' | 'CHECK_CONNECTION' | 'CHECK_CREDENTIALS' | 'RECONCILE' | 'CONTACT_SUPPORT';
  /** Entity the operator must act on, e.g. the unmapped MES item code. */
  subject?: string;
  /** Raw response from BUSY, kept verbatim for the audit trail. */
  busyResponse?: string;
  [key: string]: unknown;
}

export class BridgeError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: BridgeErrorDetails;

  constructor(code: ErrorCode, message: string, details: BridgeErrorDetails = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.retryable = RETRYABLE[code];
    this.details = details;
  }

  /**
   * Operator-facing explanation. The spec asks for errors a factory
   * administrator can act on without reading source code, e.g.
   *
   *   FAILED  Dispatch DH-DSP-00091
   *   Reason: BUSY item code BUSY-4587 could not be mapped.
   *   Action: Map MES item FC-00125 to a BUSY item.
   */
  explain(): { reason: string; action: string } {
    const subject = this.details.subject;
    switch (this.code) {
      case 'CONNECTION_ERROR':
        return {
          reason: `BUSY could not be reached. ${this.message}`,
          action:
            'No action needed yet — the transaction stays queued and is retried automatically. ' +
            'If this persists, check that BUSY is running and the shared folder is reachable.',
        };
      case 'AUTHENTICATION_ERROR':
        return {
          reason: `BUSY rejected the bridge's credentials. ${this.message}`,
          action: 'Check the BUSY credentials in the bridge configuration. Retrying will not help until they are corrected.',
        };
      case 'VALIDATION_ERROR':
        return {
          reason: `The transaction failed validation before it was sent to BUSY. ${this.message}`,
          action: subject
            ? `Correct "${subject}" in the MES record, then retry.`
            : 'Correct the MES record, then retry.',
        };
      case 'MASTER_MAPPING_ERROR': {
        // Name the kind of record too ("MES item FC-00125"), so the operator
        // knows which mapping table to open.
        const kind = typeof this.details.entityType === 'string' ? this.details.entityType.toLowerCase() : 'record';
        return {
          reason: subject
            ? `MES ${kind} "${subject}" is not mapped to a BUSY ${kind}.`
            : `A master record is not mapped to BUSY. ${this.message}`,
          action: subject
            ? `Map MES ${kind} "${subject}" to the matching BUSY ${kind}, then retry.`
            : 'Create the missing master mapping, then retry.',
        };
      }
      case 'DUPLICATE_ERROR':
        return {
          reason: `BUSY already holds this transaction. ${this.message}`,
          action: 'No resend is needed. Reconcile to attach the existing BUSY reference to the MES record.',
        };
      case 'BUSY_TRANSACTION_ERROR':
        return {
          reason: `BUSY rejected the transaction. ${this.message}`,
          action: 'Review the BUSY response, correct the transaction in MES or in BUSY, then retry.',
        };
      case 'TIMEOUT':
        return {
          reason: `BUSY did not respond in time. ${this.message}`,
          action:
            'The transaction stays queued and is retried automatically. ' +
            'Confirm in BUSY that it was not partially posted before forcing a manual retry.',
        };
      case 'UNSUPPORTED_OPERATION':
        return {
          reason: `This BUSY installation does not support that operation. ${this.message}`,
          action:
            'This is a capability limit of the configured BUSY edition or transport, not a transient fault. ' +
            'See docs/BUSY_INTEGRATION.md for the capability matrix.',
        };
      default:
        return {
          reason: `An unexpected error occurred. ${this.message}`,
          action: 'Review the payload and the BUSY response in the audit log, then decide whether to retry.',
        };
    }
  }

  toJSON() {
    const { reason, action } = this.explain();
    return { code: this.code, message: this.message, retryable: this.retryable, reason, action, details: this.details };
  }
}

/** Raised when an operation is not available on the configured BUSY transport. */
export class UnsupportedOperationError extends BridgeError {
  constructor(operation: string, adapter: string) {
    super('UNSUPPORTED_OPERATION', `Operation "${operation}" is not supported by the "${adapter}" BUSY adapter.`, {
      action: 'CONTACT_SUPPORT',
      subject: operation,
    });
    this.name = 'UnsupportedOperationError';
  }
}

export class ValidationError extends BridgeError {
  readonly issues: string[];
  constructor(message: string, issues: string[] = [], subject?: string) {
    super('VALIDATION_ERROR', message, { action: 'FIX_DATA', subject, issues });
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class MappingError extends BridgeError {
  constructor(entityType: string, mesId: string) {
    super('MASTER_MAPPING_ERROR', `No BUSY mapping exists for ${entityType} "${mesId}".`, {
      action: 'FIX_MAPPING',
      subject: mesId,
      entityType,
    });
    this.name = 'MappingError';
  }
}

/**
 * Normalise anything thrown anywhere into a classified BridgeError.
 * Node's network errors carry recognisable codes; we map those rather than
 * letting a connection blip masquerade as an unknown failure (which would
 * change its retry behaviour).
 */
export function classifyError(err: unknown): BridgeError {
  if (err instanceof BridgeError) return err;

  const e = err as NodeJS.ErrnoException & { name?: string };
  const code = e?.code;
  const message = e?.message ?? String(err);

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || e?.name === 'AbortError' || e?.name === 'TimeoutError') {
    return new BridgeError('TIMEOUT', message, { action: 'CHECK_CONNECTION' });
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE' ||
    code === 'ENOENT' || // shared folder missing => BUSY side not mounted
    code === 'EACCES' ||
    code === 'EPERM'
  ) {
    return new BridgeError('CONNECTION_ERROR', message, { action: 'CHECK_CONNECTION' });
  }
  return new BridgeError('UNKNOWN_ERROR', message, { action: 'CONTACT_SUPPORT' });
}
