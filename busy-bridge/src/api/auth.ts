import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Config, Role } from '../config';

/**
 * Authentication and authorisation.
 *
 * Two separate doors:
 *  - the MES door (X-Bridge-Key), for queueing work;
 *  - the admin door (X-Admin-Key), for reading state and forcing actions.
 *
 * The customer portal has no door here at all, by design: per the spec it must
 * never communicate with BUSY, directly or through this service.
 */

export interface Principal {
  kind: 'mes' | 'admin';
  role: Role;
  /** Non-secret label for the audit trail. Never the key itself. */
  label: string;
}

const ROLE_RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

/**
 * Constant-time comparison.
 *
 * A plain `===` on an API key leaks its prefix through timing. The length
 * check is unavoidable (and not secret), but the comparison itself must not
 * vary with how many characters matched.
 */
function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** A short, non-reversible label so audit rows can say who acted. */
function labelFor(key: string): string {
  return `key:${key.slice(0, 4)}***`;
}

export function authenticate(req: IncomingMessage, config: Config): Principal | null {
  const adminKey = header(req, 'x-admin-key');
  if (adminKey) {
    for (const [key, role] of config.adminKeys) {
      if (secureEquals(adminKey, key)) {
        return { kind: 'admin', role, label: labelFor(key) };
      }
    }
    return null;
  }

  const mesKey = header(req, 'x-bridge-key');
  if (mesKey && secureEquals(mesKey, config.mesApiKey)) {
    // MES may queue work; it may not perform administrative actions.
    return { kind: 'mes', role: 'operator', label: 'mes' };
  }

  return null;
}

export function hasRole(principal: Principal, required: Role): boolean {
  return ROLE_RANK[principal.role] >= ROLE_RANK[required];
}
