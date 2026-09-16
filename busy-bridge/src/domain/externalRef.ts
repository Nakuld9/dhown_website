import type { EntityType } from '../config';
import { ValidationError } from '../errors';

/**
 * External references are the bridge's idempotency keys.
 *
 * Format:  DHOWN-<ENTITY>-<YEAR>-<SEQUENCE>
 * Example: DHOWN-DISPATCH-2026-000091
 *
 * Two properties matter and both are load-bearing:
 *
 *  1. DETERMINISTIC. The same MES record always produces the same reference,
 *     so a duplicate delivery from MES (retry, double-click, replayed webhook)
 *     collapses onto the same key instead of creating a second BUSY voucher.
 *  2. UNIQUE. Enforced by a UNIQUE index in the database, not just by this
 *     function, so a race between two workers cannot produce a duplicate.
 */

const PREFIX = 'DHOWN';
const SEQUENCE_WIDTH = 6;

/** Matches a well-formed external reference. */
export const EXTERNAL_REF_PATTERN = /^DHOWN-[A-Z_]+-\d{4}-\d{6,}$/;

export interface ExternalRefParts {
  entityType: EntityType;
  year: string;
  sequence: string;
}

/**
 * Derive the numeric sequence from the MES document number.
 *
 * MES document numbers carry a sequence already (DH-DSP-00091 -> 91). Reusing
 * it keeps the BUSY reference legible to humans comparing the two systems side
 * by side, which is what reconciliation actually looks like in practice.
 *
 * If a document number carries no digits we cannot derive a stable sequence,
 * and inventing one would break determinism — so we refuse rather than guess.
 */
export function deriveSequence(documentNumber: string): string {
  const digits = documentNumber.match(/\d+/g);
  if (!digits || digits.length === 0) {
    throw new ValidationError(
      `Cannot derive an idempotency sequence from document number "${documentNumber}": it contains no digits.`,
      ['documentNumber must contain at least one digit'],
      documentNumber,
    );
  }
  // Last numeric group is the document sequence in every MES numbering scheme
  // in use (DH-DSP-00091, DH/INV/2026/0042).
  const last = digits[digits.length - 1]!;
  const normalised = last.replace(/^0+/, '') || '0';
  return normalised.padStart(SEQUENCE_WIDTH, '0');
}

export function buildExternalReference(
  entityType: EntityType,
  documentNumber: string,
  fiscalYear?: string,
): string {
  const year = (fiscalYear ?? String(new Date().getUTCFullYear())).trim();
  if (!/^\d{4}$/.test(year)) {
    throw new ValidationError(`Fiscal year must be a 4-digit year, got "${year}".`, ['fiscalYear'], documentNumber);
  }
  return `${PREFIX}-${entityType}-${year}-${deriveSequence(documentNumber)}`;
}

/**
 * Master records have no document number. Their identity is the MES id, which
 * is already stable, so the reference is built from that directly.
 */
export function buildMasterExternalReference(entityType: EntityType, mesId: string): string {
  const safe = mesId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (!safe) {
    throw new ValidationError(`Cannot build an external reference from MES id "${mesId}".`, ['mesId'], mesId);
  }
  const digits = safe.match(/\d+/g);
  const sequence = digits ? digits.join('').slice(-12).padStart(SEQUENCE_WIDTH, '0') : null;
  if (sequence) {
    return `${PREFIX}-${entityType}-${new Date().getUTCFullYear()}-${sequence}`;
  }
  // Purely alphabetic MES ids: fall back to a stable hash of the id so the
  // reference is still deterministic.
  let hash = 0;
  for (const ch of safe) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${PREFIX}-${entityType}-${new Date().getUTCFullYear()}-${String(hash % 1_000_000).padStart(SEQUENCE_WIDTH, '0')}`;
}

export function parseExternalReference(ref: string): ExternalRefParts | null {
  if (!EXTERNAL_REF_PATTERN.test(ref)) return null;
  const parts = ref.split('-');
  // Entity types may themselves contain "_" but never "-", so the split is safe.
  const sequence = parts[parts.length - 1]!;
  const year = parts[parts.length - 2]!;
  const entityType = parts.slice(1, parts.length - 2).join('-') as EntityType;
  return { entityType, year, sequence };
}

/** Filenames derived from a reference must never escape the outbox directory. */
export function assertSafeReference(ref: string): void {
  if (!EXTERNAL_REF_PATTERN.test(ref)) {
    throw new ValidationError(`Refusing to use "${ref}" as a filename: not a valid external reference.`, ['externalReference'], ref);
  }
}
