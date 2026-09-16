import type { IncomingMessage, ServerResponse } from 'node:http';
import { BridgeError, classifyError } from '../errors';
import { log } from '../logger';

/** Small HTTP helpers shared by the internal and admin routers. */

export const MAX_BODY_BYTES = 1_000_000; // 1 MB — a commercial document, not a file upload

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, status: number, err: unknown): void {
  const error = err instanceof BridgeError ? err : classifyError(err);
  const { reason, action } = error.explain();
  sendJson(res, status, {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      reason,
      action,
      retryable: error.retryable,
      ...(Array.isArray((error.details as any).issues) ? { issues: (error.details as any).issues } : {}),
    },
  });
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new BridgeError('VALIDATION_ERROR', `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) throw new BridgeError('VALIDATION_ERROR', 'Request body is empty; expected JSON.');
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BridgeError('VALIDATION_ERROR', 'Request body is not valid JSON.');
  }
}

export function notFound(res: ServerResponse, what = 'Route'): void {
  sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `${what} not found.` } });
}

export function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
}

export function logRequest(req: IncomingMessage, status: number, startedAt: number): void {
  log.debug('http', {
    method: req.method,
    url: req.url,
    status,
    durationMs: Date.now() - startedAt,
  });
}
